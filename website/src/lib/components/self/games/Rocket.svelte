<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import confetti from 'canvas-confetti';
	import { toast } from 'svelte-sonner';
	import { formatValue, playSound, showConfetti, showSchoolPrideCannons } from '$lib/utils';
	import { volumeSettings } from '$lib/stores/volume-settings';
	import { onMount, onDestroy } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { fetchPortfolioSummary } from '$lib/stores/portfolio-data';

	const MAX_BET_AMOUNT = 1000000;
	const UPDATE_INTERVAL = 50; // Update multiplier every 50ms for smooth animation
	const STATUS_POLL_INTERVAL = 200; // Poll server status every 200ms

	let {
		balance = $bindable(),
		onBalanceUpdate
	}: {
		balance: number;
		onBalanceUpdate?: (newBalance: number) => void;
	} = $props();

	let betAmount = $state(10);
	let betAmountDisplay = $state('10');
	let isPlaying = $state(false);
	// CRITICAL: currentMultiplier is ONLY set from backend API responses - NEVER calculated on frontend
	// This prevents cheating - all multiplier values come from server validation
	let currentMultiplier = $state(1.0);
	let sessionToken = $state<string | null>(null);
	let gameStartTime = $state<number | null>(null);
	let updateInterval: ReturnType<typeof setInterval> | null = null;
	let statusPollInterval: ReturnType<typeof setInterval> | null = null;
	let hasCrashed = $state(false);
	let cashedOut = $state(false);
	let crashedAt = $state<number | null>(null);
	let cashedOutAt = $state<number | null>(null);
	let gameEnded = $state(false);

	let canBet = $derived(
		betAmount > 0 && betAmount <= balance && betAmount <= MAX_BET_AMOUNT && !isPlaying
	);

	let currentProfit = $derived(
		isPlaying && !cashedOut && !hasCrashed
			? betAmount * (currentMultiplier - 1)
			: 0
	);

	// Calculate rocket position using exponential growth (similar to Phaser implementation)
	let rocketX = $state(50);
	let rocketY = $state(360); // Start at bottom
	let rocketAngle = $state(90);
	let rocketScale = $state(0.3);
	let pathProgress = $state(0);
	let pathX = $state(60); // Path X coordinate in SVG space
	let pathY = $state(372); // Path Y coordinate in SVG space

	// Exponential growth function (from Phaser code)
	function growthFunc(ms: number): number {
		return Math.floor(100 * Math.pow(Math.E, 0.00000000001 * ms));
	}

	// Calculate rocket position based on elapsed time and multiplier
	// IMPORTANT: currentMultiplier comes ONLY from backend - never calculated here
	function calculateRocketPosition() {
		if (!gameStartTime || hasCrashed || cashedOut) return;

		const elapsed = Date.now() - gameStartTime;
		const containerHeight = 400;
		const containerWidth = 1000; // SVG viewBox width
		
		// Map multiplier to Y position (1.0x at bottom, higher multipliers at top)
		// Use a logarithmic scale to match the exponential growth
		// Cap the display multiplier to keep rocket visible
		// currentMultiplier is ONLY from backend API - never calculated on frontend
		const displayMultiplier = Math.min(currentMultiplier, 100);
		const maxDisplayMultiplier = 100; // Max multiplier shown on graph
		const minY = 372; // Bottom of graph (at 1.0x)
		const maxY = 30; // Top of graph
		
		// Calculate Y position based on multiplier (logarithmic scale)
		// multiplier 1.0 -> Y = 372 (bottom)
		// multiplier 100 -> Y = 30 (top)
		const logMultiplier = Math.log(Math.max(displayMultiplier, 1.0));
		const logMax = Math.log(maxDisplayMultiplier);
		const logMin = Math.log(1.0);
		const normalizedMultiplier = (logMultiplier - logMin) / (logMax - logMin);
		const yPixel = minY - (normalizedMultiplier * (minY - maxY));
		
		// Clamp Y position to stay within bounds
		const clampedYPixel = Math.max(Math.min(yPixel, minY), maxY);
		
		// Calculate X position based on elapsed time (curved path)
		// Cap X movement to keep rocket visible
		const maxXPixel = containerWidth - 100; // Leave margin on right
		const xPixel = Math.min(60 + elapsed / 10 - 0.02 * Math.pow(elapsed, 1.1), maxXPixel);
		const xPercent = Math.min((xPixel / containerWidth) * 100, 90);
		rocketX = xPercent;
		rocketY = clampedYPixel;

		// Store path coordinates for drawing (use same coordinates as rocket)
		pathX = xPixel;
		pathY = clampedYPixel;

		// Calculate angle based on trajectory - point upward along the path
		// Use a small time delta to calculate direction (NO MULTIPLIER CALCULATION - only visual)
		const deltaTime = 50; // 50ms ahead
		const nextElapsed = elapsed + deltaTime;
		
		// Calculate next position based ONLY on time (visual only, not multiplier)
		// This is just for smooth animation - multiplier comes ONLY from backend
		const nextXPixel = Math.min(60 + nextElapsed / 10 - 0.02 * Math.pow(nextElapsed, 1.1), maxXPixel);
		// Estimate next Y based on time progression (visual smoothing only)
		const timeProgress = Math.min(nextElapsed / 30000, 1); // Assume ~30s for full height
		const nextYPixelEstimate = minY - (timeProgress * (minY - maxY));
		const nextYPixel = Math.max(Math.min(nextYPixelEstimate, minY), maxY);
		
		// Calculate angle from current to next position (visual only)
		const dx = nextXPixel - xPixel;
		const dy = nextYPixel - clampedYPixel;
		// Convert to degrees, adjust so 0 is pointing up (negative dy because Y increases downward)
		// Allow more angle range for better movement (-75 to 75 degrees)
		let angle = Math.atan2(-dy, dx) * (180 / Math.PI) + 90;
		angle = Math.max(-75, Math.min(75, angle)); // Clamp angle but allow more range
		rocketAngle = angle;

		// Scale up as rocket goes higher - make it significantly bigger
		const heightProgress = Math.min(normalizedMultiplier, 1.0);
		// Scale from 0.3 (bottom) to 1.2 (top) - much bigger as it goes higher
		rocketScale = 0.3 + (heightProgress * 0.9);

		// Path progress for trail (0 to 1) - based on X movement
		pathProgress = Math.min((xPixel - 60) / (maxXPixel - 60), 1);
	}

	function setBetAmount(amount: number) {
		const clamped = Math.min(amount, Math.min(balance, MAX_BET_AMOUNT));
		if (clamped >= 0) {
			betAmount = clamped;
			betAmountDisplay = clamped.toLocaleString();
		}
	}

	function handleBetAmountInput(event: Event) {
		const value = (event.target as HTMLInputElement).value.replace(/,/g, '');
		const num = parseFloat(value) || 0;
		const clamped = Math.min(num, Math.min(balance, MAX_BET_AMOUNT));
		betAmount = clamped;
		betAmountDisplay = value;
	}

	function handleBetAmountBlur() {
		betAmountDisplay = betAmount.toLocaleString();
	}

	function stopGame() {
		if (updateInterval) {
			clearInterval(updateInterval);
			updateInterval = null;
		}
		if (statusPollInterval) {
			clearInterval(statusPollInterval);
			statusPollInterval = null;
		}
	}

	async function pollStatus() {
		if (!sessionToken || !isPlaying) return;

		try {
			const response = await fetch(`/api/gambling/rocket/status?sessionToken=${sessionToken}`);
			if (!response.ok) {
				if (response.status === 400) {
					// Session invalid or crashed
					handleCrash();
					return;
				}
				throw new Error('Failed to get status');
			}

			const result = await response.json();
			if (result.crashed && !hasCrashed) {
				// Use the multiplier from server when crashed
				if (result.multiplier) {
					currentMultiplier = result.multiplier;
				}
				handleCrash();
			} else if (result.multiplier) {
				// Always use server multiplier for accuracy
				currentMultiplier = result.multiplier;
			}
		} catch (error) {
			console.error('Status poll error:', error);
		}
	}

	async function handleCrash() {
		hasCrashed = true;
		crashedAt = currentMultiplier;
		gameEnded = true;
		isPlaying = false;
		stopGame();
		playSound('lose');
		
		// Fetch updated balance to show the loss
		try {
			const data = await fetchPortfolioSummary();
			if (data) {
				balance = data.baseCurrencyBalance;
				onBalanceUpdate?.(data.baseCurrencyBalance);
			}
		} catch (error) {
			console.error('Failed to fetch balance after crash:', error);
		}
	}

	async function cashOut() {
		if (!isPlaying || !sessionToken || cashedOut || hasCrashed) return;

		try {
			const response = await fetch('/api/gambling/rocket/cashout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionToken })
			});

			if (!response.ok) {
				const errorData = await response.json();
				if (errorData.error === 'Invalid session' || errorData.crashed) {
					handleCrash();
					return;
				}
				throw new Error(errorData.error || 'Failed to cash out');
			}

			const result = await response.json();

			if (result.crashed) {
				handleCrash();
				return;
			}

			cashedOut = true;
			cashedOutAt = result.multiplier;
			gameEnded = true;
			isPlaying = false;
			balance = result.newBalance;
			onBalanceUpdate?.(balance);

			if (result.payout > betAmount) {
				showConfetti(confetti);
				showSchoolPrideCannons(confetti);
			}
			playSound('win');
			stopGame();

			toast.success('Cashed out!', {
				description: `You won ${formatValue(result.payout)} at ${result.multiplier.toFixed(2)}x`
			});
		} catch (error) {
			console.error('Cashout error:', error);
			toast.error('Failed to cash out', {
				description: error instanceof Error ? error.message : 'Unknown error occurred'
			});
		}
	}

	async function startGame() {
		if (!canBet) return;

		balance -= betAmount;
		onBalanceUpdate?.(balance);

		try {
			const response = await fetch('/api/gambling/rocket/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ betAmount })
			});

			if (!response.ok) {
				const errorData = await response.json();
				balance += betAmount;
				onBalanceUpdate?.(balance);
				throw new Error(errorData.error || 'Failed to start game');
			}

			const result = await response.json();
			isPlaying = true;
			hasCrashed = false;
			cashedOut = false;
			crashedAt = null;
			cashedOutAt = null;
			currentMultiplier = 1.0;
			sessionToken = result.sessionToken;
			gameStartTime = Date.now();
			gameEnded = false;

			// Start polling server for multiplier updates (ONLY source of truth)
			statusPollInterval = setInterval(pollStatus, STATUS_POLL_INTERVAL);
			
			// Update rocket position ONLY (multiplier comes ONLY from server polling)
			updateInterval = setInterval(() => {
				if (gameStartTime && !hasCrashed && !cashedOut) {
					// Update rocket position - multiplier is ONLY from backend
					calculateRocketPosition();
				}
			}, UPDATE_INTERVAL);

			playSound('click');
		} catch (error) {
			console.error('Start game error:', error);
			toast.error('Failed to start game', {
				description: error instanceof Error ? error.message : 'Unknown error occurred'
			});
		}
	}

	function resetGame() {
		isPlaying = false;
		hasCrashed = false;
		cashedOut = false;
		crashedAt = null;
		cashedOutAt = null;
		currentMultiplier = 1.0;
		sessionToken = null;
		gameStartTime = null;
		gameEnded = false;
		rocketX = 50;
		rocketY = 360;
		rocketAngle = 90;
		rocketScale = 0.3;
		pathProgress = 0;
		pathX = 60;
		pathY = 372;
		stopGame();
	}

	onMount(async () => {
		volumeSettings.load();
		try {
			const data = await fetchPortfolioSummary();
			if (data) {
				balance = data.baseCurrencyBalance;
				onBalanceUpdate?.(data.baseCurrencyBalance);
			}
		} catch (error) {
			console.error('Failed to fetch balance:', error);
		}
	});

	onDestroy(() => {
		stopGame();
	});
</script>

<Card>
	<CardHeader>
		<CardTitle>Rocket</CardTitle>
		<CardDescription>
			Watch the rocket fly! Cash out before it crashes to win!
		</CardDescription>
	</CardHeader>
	<CardContent>
		<div class="grid grid-cols-1 gap-8 md:grid-cols-2">
			<!-- Left Side: Rocket Display -->
			<div class="flex flex-col space-y-4">
				<!-- Balance Display -->
				<div class="text-center">
					<p class="text-muted-foreground text-sm">Balance</p>
					<p class="text-2xl font-bold">{formatValue(balance)}</p>
				</div>

				<!-- Rocket Display -->
				<div class="rocket-container">
					<ModeWatcher />
					<!-- Ground/Background -->
					<div class="ground-layer"></div>
					
					<!-- Graph Axes -->
					<svg class="graph-axes" viewBox="0 0 1000 400" preserveAspectRatio="none">
						<!-- Y-axis -->
						<line x1="60" y1="30" x2="60" y2="372" stroke="var(--border)" stroke-width="1" />
						<!-- X-axis -->
						<line x1="60" y1="372" x2="900" y2="372" stroke="var(--border)" stroke-width="1" />
						
						<!-- Y-axis labels - dynamic scaling based on current multiplier -->
						{#if Math.min(currentMultiplier, 100) >= 2.4}
							{@const displayMultiplier = Math.min(currentMultiplier, 100)}
							{@const maxLabel = displayMultiplier > 10 ? 100 : displayMultiplier > 5 ? 50 : displayMultiplier > 2.4 ? 10 : 5}
							<text x="55" y="50" text-anchor="end" class="axis-label">
								{maxLabel.toFixed(displayMultiplier >= 10 ? 0 : 2)}x
							</text>
							<text x="55" y="130" text-anchor="end" class="axis-label">
								{((maxLabel - 1) * 0.75 + 1).toFixed(displayMultiplier >= 10 ? 0 : 2)}x
							</text>
							<text x="55" y="210" text-anchor="end" class="axis-label">
								{((maxLabel - 1) * 0.5 + 1).toFixed(displayMultiplier >= 10 ? 0 : 2)}x
							</text>
							<text x="55" y="290" text-anchor="end" class="axis-label">
								{((maxLabel - 1) * 0.25 + 1).toFixed(displayMultiplier >= 10 ? 0 : 2)}x
							</text>
						{:else}
							<text x="55" y="50" text-anchor="end" class="axis-label">2.60x</text>
							<text x="55" y="130" text-anchor="end" class="axis-label">2.20x</text>
							<text x="55" y="210" text-anchor="end" class="axis-label">1.80x</text>
							<text x="55" y="290" text-anchor="end" class="axis-label">1.40x</text>
						{/if}
						<text x="55" y="355" text-anchor="end" class="axis-label">1.00x</text>
					</svg>

					<!-- Rocket Path/Trail -->
					{#if isPlaying && !hasCrashed && !cashedOut}
						<svg class="rocket-path" viewBox="0 0 1000 400" preserveAspectRatio="none">
							<defs>
								<linearGradient id="pathGradient" x1="0%" y1="0%" x2="100%" y2="0%">
									<stop offset="0%" style="stop-color:var(--primary);stop-opacity:0.3" />
									<stop offset="100%" style="stop-color:var(--primary);stop-opacity:0.8" />
								</linearGradient>
								<mask id="pathMask">
									<rect x="0" y="0" width="{Math.max(60, pathProgress * 1000)}" height="400" fill="white" />
								</mask>
							</defs>
							<path
								d="M 60 372 Q {pathX * 0.5} {(372 + pathY) / 2} {pathX} {pathY}"
								stroke="url(#pathGradient)"
								stroke-width="3"
								fill="none"
								mask="url(#pathMask)"
								class="path-line"
							/>
						</svg>
					{/if}

					<!-- Rocket -->
					<div
						class="rocket-wrapper"
						class:crashed={hasCrashed}
						class:cashed-out={cashedOut}
						style="left: {(pathX / 10)}%; top: {rocketY}px; transform: rotate({rocketAngle}deg) scale({rocketScale});"
					>
						<div class="rocket">
							{#if isPlaying && !hasCrashed && !cashedOut}
								<div class="rocket-flame">
									<div class="flame flame-1"></div>
									<div class="flame flame-2"></div>
									<div class="flame flame-3"></div>
								</div>
							{/if}
							<svg
								width="80"
								height="100"
								viewBox="0 0 32 40"
								fill="none"
								xmlns="http://www.w3.org/2000/svg"
								class="rocket-svg"
							>
								<defs>
									<linearGradient id="rocketGradient" x1="0%" y1="0%" x2="0%" y2="100%">
										<stop offset="0%" style="stop-color:#3b82f6;stop-opacity:1" />
										<stop offset="50%" style="stop-color:#2563eb;stop-opacity:1" />
										<stop offset="100%" style="stop-color:#1e40af;stop-opacity:1" />
									</linearGradient>
									<linearGradient id="rocketGradientCrashed" x1="0%" y1="0%" x2="0%" y2="100%">
										<stop offset="0%" style="stop-color:#ef4444;stop-opacity:1" />
										<stop offset="50%" style="stop-color:#dc2626;stop-opacity:1" />
										<stop offset="100%" style="stop-color:#b91c1c;stop-opacity:1" />
									</linearGradient>
									<linearGradient id="rocketGradientCashedOut" x1="0%" y1="0%" x2="0%" y2="100%">
										<stop offset="0%" style="stop-color:#22c55e;stop-opacity:1" />
										<stop offset="50%" style="stop-color:#16a34a;stop-opacity:1" />
										<stop offset="100%" style="stop-color:#15803d;stop-opacity:1" />
									</linearGradient>
									<filter id="rocketGlow">
										<feGaussianBlur stdDeviation="2" result="coloredBlur"/>
										<feMerge>
											<feMergeNode in="coloredBlur"/>
											<feMergeNode in="SourceGraphic"/>
										</feMerge>
									</filter>
								</defs>
								<!-- Rocket body main -->
								<path
									d="M16 2 L8 10 L8 24 L16 32 L24 24 L24 10 Z"
									fill="url(#rocketGradient)"
									stroke="rgba(255,255,255,0.3)"
									stroke-width="0.8"
									filter="url(#rocketGlow)"
									class:rocket-crashed={hasCrashed}
									class:rocket-cashed-out={cashedOut}
								/>
								<!-- Rocket body highlight -->
								<path
									d="M16 4 L10 10 L10 22 L16 28 L22 22 L22 10 Z"
									fill="rgba(255,255,255,0.2)"
								/>
								<!-- Rocket window frame -->
								<ellipse cx="16" cy="16" rx="5" ry="6" fill="rgba(59, 130, 246, 0.3)" stroke="rgba(255,255,255,0.5)" stroke-width="0.5" />
								<ellipse cx="16" cy="16" rx="3.5" ry="4.5" fill="rgba(147, 197, 253, 0.6)" />
								<ellipse cx="16" cy="16" rx="2" ry="2.5" fill="rgba(255,255,255,0.8)" />
								<!-- Rocket fins left -->
								<path d="M8 10 L4 14 L6 18 L8 16" fill="url(#rocketGradient)" stroke="rgba(255,255,255,0.2)" stroke-width="0.5" />
								<path d="M8 10 L4 14 L6 18 L8 16" fill="rgba(0,0,0,0.2)" />
								<!-- Rocket fins right -->
								<path d="M24 10 L28 14 L26 18 L24 16" fill="url(#rocketGradient)" stroke="rgba(255,255,255,0.2)" stroke-width="0.5" />
								<path d="M24 10 L28 14 L26 18 L24 16" fill="rgba(0,0,0,0.2)" />
								<!-- Rocket nose cone -->
								<path d="M16 2 L12 6 L16 8 L20 6 Z" fill="rgba(255,255,255,0.4)" />
								<!-- Rocket details -->
								<line x1="12" y1="20" x2="20" y2="20" stroke="rgba(255,255,255,0.3)" stroke-width="0.5" />
								<line x1="12" y1="24" x2="20" y2="24" stroke="rgba(255,255,255,0.3)" stroke-width="0.5" />
							</svg>
						</div>
					</div>

					<!-- Multiplier Display -->
					<div class="multiplier-display">
						<div class="multiplier-value" class:warning={currentMultiplier >= 10}>
							{currentMultiplier.toFixed(2)}x
						</div>
						{#if hasCrashed && crashedAt}
							<div class="crashed-text">Crashed at {crashedAt.toFixed(2)}x</div>
						{:else if cashedOut && cashedOutAt}
							<div class="cashed-out-text">Cashed out at {cashedOutAt.toFixed(2)}x</div>
						{/if}
					</div>

					<!-- Explosion on crash -->
					{#if hasCrashed && crashedAt}
						<div
							class="explosion"
							style="left: {rocketX}%; top: {rocketY}px;"
						>
							<div class="explosion-circle"></div>
							<div class="explosion-circle delay-1"></div>
							<div class="explosion-circle delay-2"></div>
						</div>
					{/if}
				</div>
			</div>

			<!-- Right Side: Controls -->
			<div class="space-y-4">
				<div>
					<label for="bet-amount" class="mb-2 block text-sm font-medium">Bet Amount</label>
					<Input
						id="bet-amount"
						type="text"
						value={betAmountDisplay}
						oninput={handleBetAmountInput}
						onblur={handleBetAmountBlur}
						disabled={isPlaying}
						placeholder="Enter bet amount"
					/>
					<p class="text-muted-foreground mt-1 text-xs">
						Max bet: {MAX_BET_AMOUNT.toLocaleString()}
					</p>
				</div>
				<div>
					<div class="grid grid-cols-4 gap-2">
						<Button
							size="sm"
							variant="outline"
							onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT) * 0.25))}
							disabled={isPlaying}>25%</Button
						>
						<Button
							size="sm"
							variant="outline"
							onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT) * 0.5))}
							disabled={isPlaying}>50%</Button
						>
						<Button
							size="sm"
							variant="outline"
							onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT) * 0.75))}
							disabled={isPlaying}>75%</Button
						>
						<Button
							size="sm"
							variant="outline"
							onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT)))}
							disabled={isPlaying}>Max</Button
						>
					</div>
				</div>
				<div class="flex flex-col gap-2">
					{#if !isPlaying}
						<Button class="h-12 flex-1 text-lg" onclick={startGame} disabled={!canBet}>
							Launch Rocket
						</Button>
					{:else}
						<Button
							class="h-12 flex-1 text-lg {currentMultiplier > 2 && !cashedOut && !hasCrashed ? 'success' : ''}"
							onclick={cashOut}
							disabled={cashedOut || hasCrashed}
						>
							{#if cashedOut}
								Cashed Out
							{:else if hasCrashed}
								Crashed
							{:else}
								Cash Out
							{/if}
						</Button>
						{#if !gameEnded}
							<Button
								variant="outline"
								class="h-10"
								onclick={resetGame}
							>
								Reset
							</Button>
						{/if}
						<!-- Current Stats -->
						{#if !cashedOut && !hasCrashed}
							<div class="bg-muted/50 space-y-2 rounded-lg p-3">
								<div class="flex justify-between">
									<span>Current Profit:</span>
									<span class="text-success">
										+{formatValue(currentProfit)}
									</span>
								</div>
								<div class="flex justify-between">
									<span>Potential Payout:</span>
									<span>
										{formatValue(betAmount * currentMultiplier)}
									</span>
								</div>
								<div class="flex justify-between">
									<span>Current Multiplier:</span>
									<span class="font-bold">{currentMultiplier.toFixed(2)}x</span>
								</div>
							</div>
						{:else if cashedOut && cashedOutAt}
							<div class="bg-success/10 space-y-2 rounded-lg p-3 border border-success/20">
								<div class="flex justify-between">
									<span>You cashed out at:</span>
									<span class="text-success font-bold">{cashedOutAt.toFixed(2)}x</span>
								</div>
								<div class="flex justify-between">
									<span>Profit:</span>
									<span class="text-success font-bold">
										+{formatValue(betAmount * (cashedOutAt - 1))}
									</span>
								</div>
							</div>
						{:else if hasCrashed && crashedAt}
							<div class="bg-destructive/10 space-y-2 rounded-lg p-3 border border-destructive/20">
								<div class="flex justify-between">
									<span>Rocket crashed at:</span>
									<span class="text-destructive font-bold">{crashedAt.toFixed(2)}x</span>
								</div>
								<div class="flex justify-between">
									<span>Loss:</span>
									<span class="text-destructive font-bold">
										-{formatValue(betAmount)}
									</span>
								</div>
								<div class="flex justify-between text-xs text-muted-foreground mt-1">
									<span>New Balance:</span>
									<span>{formatValue(balance)}</span>
								</div>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		</div>
	</CardContent>
</Card>

<style>
	.rocket-container {
		position: relative;
		width: 100%;
		height: 400px;
		background: linear-gradient(to top, var(--muted) 0%, var(--background) 100%);
		border: 2px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.ground-layer {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 40px;
		background: linear-gradient(
			to top,
			var(--muted) 0%,
			var(--card) 50%,
			var(--muted) 100%
		);
		z-index: 1;
	}

	.graph-axes {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		z-index: 2;
		pointer-events: none;
	}

	.axis-label {
		font-size: 12px;
		font-weight: bold;
		fill: var(--foreground);
		dominant-baseline: middle;
	}

	.rocket-path {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		z-index: 3;
		pointer-events: none;
	}

	.path-line {
		filter: drop-shadow(0 0 4px var(--primary));
	}

	.rocket-wrapper {
		position: absolute;
		width: 60px;
		height: 80px;
		transform-origin: center center;
		z-index: 10;
		transition: transform 0.1s ease-out;
		margin-left: -30px;
		margin-top: -40px;
		will-change: transform;
	}

	.rocket-wrapper.crashed {
		animation: crash-spin 0.8s ease-out forwards;
	}

	.rocket-wrapper.cashed-out {
		animation: cashout-pulse 0.5s ease-out;
	}

	@keyframes crash-spin {
		0% {
			transform: rotate(var(--current-angle, 0deg)) scale(var(--current-scale, 0.3));
		}
		50% {
			transform: rotate(calc(var(--current-angle, 0deg) + 180deg)) scale(1.2);
		}
		100% {
			transform: rotate(calc(var(--current-angle, 0deg) + 360deg)) scale(0.5);
			opacity: 0.5;
		}
	}

	@keyframes cashout-pulse {
		0%,
		100% {
			transform: scale(var(--current-scale, 0.3));
		}
		50% {
			transform: scale(calc(var(--current-scale, 0.3) * 1.3));
		}
	}

	.rocket {
		position: relative;
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.rocket-svg {
		filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.4)) drop-shadow(0 0 8px rgba(59, 130, 246, 0.5));
		transition: filter 0.3s ease;
	}

	.rocket-wrapper.crashed .rocket-svg {
		filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.4)) drop-shadow(0 0 8px rgba(239, 68, 68, 0.5));
	}

	.rocket-wrapper.crashed .rocket-svg path {
		fill: url(#rocketGradientCrashed) !important;
	}

	.rocket-wrapper.cashed-out .rocket-svg {
		filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.4)) drop-shadow(0 0 8px rgba(34, 197, 94, 0.5));
	}

	.rocket-wrapper.cashed-out .rocket-svg path {
		fill: url(#rocketGradientCashedOut) !important;
	}

	.rocket-flame {
		position: absolute;
		bottom: -10px;
		left: 50%;
		transform: translateX(-50%);
		width: 30px;
		height: 40px;
		display: flex;
		justify-content: center;
		align-items: flex-start;
		z-index: -1;
	}

	.flame {
		position: absolute;
		border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
		animation: flame-flicker 0.06s infinite;
	}

	.flame-1 {
		width: 12px;
		height: 24px;
		background: linear-gradient(to top, #ff6b00, #ffaa00);
		left: 50%;
		transform: translateX(-50%);
		animation-delay: 0s;
		box-shadow: 0 0 10px #ff6b00;
	}

	.flame-2 {
		width: 8px;
		height: 18px;
		background: linear-gradient(to top, #ffaa00, #ffd700);
		left: 35%;
		transform: translateX(-50%);
		animation-delay: 0.02s;
		box-shadow: 0 0 8px #ffaa00;
	}

	.flame-3 {
		width: 8px;
		height: 18px;
		background: linear-gradient(to top, #ffaa00, #ffd700);
		left: 65%;
		transform: translateX(-50%);
		animation-delay: 0.04s;
		box-shadow: 0 0 8px #ffaa00;
	}

	@keyframes flame-flicker {
		0%,
		100% {
			transform: translateX(-50%) scaleY(1) scaleX(1);
			opacity: 1;
		}
		50% {
			transform: translateX(-50%) scaleY(1.3) scaleX(0.7);
			opacity: 0.9;
		}
	}

	.multiplier-display {
		position: absolute;
		top: 100px;
		left: 100px;
		text-align: left;
		z-index: 20;
	}

	.multiplier-value {
		font-size: 3rem;
		font-weight: bold;
		color: var(--foreground);
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5), 0 0 20px rgba(255, 255, 255, 0.3);
		transition: color 0.3s;
		font-family: 'Manrope', sans-serif;
	}

	.multiplier-value.warning {
		color: var(--destructive);
		animation: pulse-warning 1s infinite;
	}

	@keyframes pulse-warning {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.7;
		}
	}

	.crashed-text,
	.cashed-out-text {
		margin-top: 8px;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.crashed-text {
		color: var(--destructive);
	}

	.cashed-out-text {
		color: var(--success);
	}

	.explosion {
		position: absolute;
		width: 100px;
		height: 100px;
		transform: translate(-50%, -50%);
		z-index: 15;
		pointer-events: none;
	}

	.explosion-circle {
		position: absolute;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		background: radial-gradient(circle, #ff6b00 0%, #ffaa00 50%, transparent 100%);
		animation: explode 0.8s ease-out forwards;
	}

	.explosion-circle.delay-1 {
		animation-delay: 0.1s;
		opacity: 0.7;
	}

	.explosion-circle.delay-2 {
		animation-delay: 0.2s;
		opacity: 0.5;
	}

	@keyframes explode {
		0% {
			transform: scale(0);
			opacity: 1;
		}
		50% {
			transform: scale(1.5);
			opacity: 0.8;
		}
		100% {
			transform: scale(2.5);
			opacity: 0;
		}
	}

	.success {
		background-color: var(--success);
		color: var(--success-foreground);
	}

	.success:hover {
		background-color: var(--success);
		opacity: 0.9;
	}
</style>
