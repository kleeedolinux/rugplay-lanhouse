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
	import { onMount } from 'svelte';
	import { fetchPortfolioSummary } from '$lib/stores/portfolio-data';
	import { ModeWatcher } from 'mode-watcher';

	const CACHE_VERSION = '2';
	const MAX_BET_AMOUNT = 1000000;
	const SPIN_DURATION = 3000; // 3 seconds spin animation

	const ROULETTE_SYMBOLS = [
		'bliptext',
		'bussin',
		'griddycode',
		'lyntr',
		'subterfuge',
		'twoblade',
		'wattesigma',
		'webx'
	];

	const BET_TYPES = {
		single: { multiplier: 8, description: 'Bet on a single icon' },
		pair: { multiplier: 4, description: 'Bet on 2 icons' },
		trio: { multiplier: 2.67, description: 'Bet on 3 icons' },
		quartet: { multiplier: 2, description: 'Bet on 4 icons' },
		half: { multiplier: 2, description: 'Bet on half the wheel (4 icons)' }
	};

	type BetType = keyof typeof BET_TYPES;

	let {
		balance = $bindable(),
		onBalanceUpdate
	}: {
		balance: number;
		onBalanceUpdate?: (newBalance: number) => void;
	} = $props();

	let betAmount = $state(10);
	let betAmountDisplay = $state('10');
	let betType = $state<BetType>('single');
	let selectedSymbols = $state<string[]>([]);
	let isSpinning = $state(false);
	let rotation = $state(0);
	let winningSymbol = $state<string | null>(null);
	let lastResult = $state<{
		won: boolean;
		winningSymbol: string;
		payout: number;
		amountWagered: number;
		multiplier: number;
	} | null>(null);

	let canBet = $derived(
		betAmount > 0 &&
		betAmount <= balance &&
		betAmount <= MAX_BET_AMOUNT &&
		!isSpinning &&
		((betType === 'single' && selectedSymbols.length === 1) ||
			(betType === 'pair' && selectedSymbols.length === 2) ||
			(betType === 'trio' && selectedSymbols.length === 3) ||
			((betType === 'quartet' || betType === 'half') && selectedSymbols.length === 4))
	);

	// Calculate angle per symbol (360 / 8 = 45 degrees)
	const ANGLE_PER_SYMBOL = 360 / ROULETTE_SYMBOLS.length;

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

	function toggleSymbol(symbol: string) {
		if (isSpinning) return;

		if (betType === 'single') {
			selectedSymbols = [symbol];
		} else {
			const index = selectedSymbols.indexOf(symbol);
			if (index > -1) {
				selectedSymbols = selectedSymbols.filter(s => s !== symbol);
			} else {
				const maxSelections =
					betType === 'pair' ? 2 : betType === 'trio' ? 3 : 4;
				if (selectedSymbols.length < maxSelections) {
					selectedSymbols = [...selectedSymbols, symbol];
				}
			}
		}
	}

	function handleBetTypeChange(newType: BetType) {
		if (isSpinning) return;
		betType = newType;
		selectedSymbols = [];
	}

	async function spin() {
		if (!canBet) return;

		isSpinning = true;
		lastResult = null;
		winningSymbol = null;

		playSound('background');

		try {
			// Get result from backend FIRST (like Slots does)
			const response = await fetch('/api/gambling/roulette', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					amount: betAmount,
					betType,
					betValue: betType === 'single' ? selectedSymbols[0] : selectedSymbols
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || 'Failed to place bet');
			}

			const result = await response.json();

			// Get winning symbol index
			const winningIndex = ROULETTE_SYMBOLS.indexOf(result.winningSymbol);
			if (winningIndex === -1) {
				console.error('Invalid winning symbol:', result.winningSymbol);
				isSpinning = false;
				return;
			}

			// Calculate exact target rotation to put winning symbol at pointer (top = 0°)
			// Each symbol is positioned at: index * 45° on the wheel
			// When wheel rotates by R, symbol at angle A appears at (A + R) mod 360
			// Pointer is at 0°, so we need: (symbolAngle + targetRotation) mod 360 = 0
			// Therefore: targetRotation = (360 - symbolAngle) mod 360
			const symbolAngleOnWheel = winningIndex * ANGLE_PER_SYMBOL;
			const targetAngle = (360 - symbolAngleOnWheel) % 360;
			
			// Get current rotation
			const baseRotation = rotation;
			const currentAngle = ((baseRotation % 360) + 360) % 360;
			
			// Calculate how many full rotations to add (always go forward)
			// Add at least 5 full rotations for visual effect
			const minFullRotations = 5;
			let fullRotations = minFullRotations;
			
			// If target angle is behind current, add one more rotation
			if (targetAngle < currentAngle) {
				fullRotations += 1;
			}
			
			// Calculate final target rotation
			const finalTargetRotation = baseRotation + (fullRotations * 360) + (targetAngle - currentAngle);
			
			// Animate to the exact target rotation
			const startTime = Date.now();
			const animate = () => {
				const elapsed = Date.now() - startTime;
				const progress = Math.min(elapsed / SPIN_DURATION, 1);
				
				// Easing function for smooth deceleration
				const easeOut = 1 - Math.pow(1 - progress, 3);
				rotation = baseRotation + (finalTargetRotation - baseRotation) * easeOut;

				if (progress < 1) {
					requestAnimationFrame(animate);
				} else {
					// Animation complete - ensure exact final position
					rotation = finalTargetRotation;
					
					// Set result and update balance
					winningSymbol = result.winningSymbol;
					lastResult = result;
					balance = result.newBalance;
					onBalanceUpdate?.(result.newBalance);

					if (result.won) {
						if (result.multiplier >= 8) {
							showSchoolPrideCannons(confetti);
							showConfetti(confetti);
						} else {
							showConfetti(confetti);
						}
						playSound('win');
					} else {
						playSound('lose');
					}

					isSpinning = false;
				}
			};
			animate();

		} catch (error) {
			console.error('Roulette error:', error);
			toast.error('Bet failed', {
				description: error instanceof Error ? error.message : 'Unknown error occurred'
			});
			isSpinning = false;
			rotation = 0;
		}
	}

	function getSymbolAngle(index: number): number {
		return index * ANGLE_PER_SYMBOL;
	}

	function getSymbolPosition(index: number): { x: number; y: number } {
		const angle = (getSymbolAngle(index) - 90) * (Math.PI / 180); // -90 to start from top
		const radius = 140; // Distance from center
		return {
			x: 50 + (radius * Math.cos(angle)) / 3.5,
			y: 50 + (radius * Math.sin(angle)) / 3.5
		};
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
</script>

<Card>
	<CardHeader>
		<CardTitle>Roulette</CardTitle>
		<CardDescription>
			Place your bets and spin the wheel! Match the winning icon to win!
		</CardDescription>
	</CardHeader>
	<CardContent>
		<div class="grid grid-cols-1 gap-8 md:grid-cols-2">
			<!-- Left Side: Roulette Wheel -->
			<div class="flex flex-col space-y-4">
				<!-- Balance Display -->
				<div class="text-center">
					<p class="text-muted-foreground text-sm">Balance</p>
					<p class="text-2xl font-bold">{formatValue(balance)}</p>
				</div>

				<!-- Roulette Wheel -->
				<div class="roulette-container">
					<ModeWatcher />
					<div class="roulette-wheel-wrapper">
						<div
							class="roulette-wheel"
							style="transform: rotate({rotation}deg); transition: {isSpinning
								? 'none'
								: 'transform 0.5s ease-out'};"
						>
							{#each ROULETTE_SYMBOLS as symbol, index}
								<div
									class="wheel-symbol"
									style="transform: rotate({getSymbolAngle(index)}deg) translateY(-110px); transform-origin: 50% 50%;"
								>
									<div
										class="symbol-slot {selectedSymbols.includes(symbol)
											? 'selected'
											: ''} {winningSymbol === symbol ? 'winning' : ''}"
									>
										<img
											src="/facedev/avif/{symbol}.avif?v={CACHE_VERSION}"
											alt={symbol}
											class="symbol-icon"
										/>
									</div>
								</div>
							{/each}
							<!-- Center circle -->
							<div class="wheel-center"></div>
						</div>
						<div class="roulette-pointer"></div>
					</div>

					<!-- Result Display -->
					{#if lastResult && !isSpinning}
						<div class="mt-4 text-center">
							<div class="bg-muted/50 rounded-lg p-3">
								{#if lastResult.won}
									<p class="text-success font-semibold text-lg">WIN!</p>
									<p class="text-sm">
										Won {formatValue(lastResult.payout)} at {lastResult.multiplier.toFixed(2)}x
									</p>
								{:else}
									<p class="text-destructive font-semibold text-lg">LOSE</p>
									<p class="text-sm">
										Lost {formatValue(lastResult.amountWagered)}
									</p>
									<p class="text-muted-foreground text-xs mt-1">
										Landed on: {lastResult.winningSymbol}
									</p>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</div>

			<!-- Right Side: Betting Controls -->
			<div class="space-y-4">
				<!-- Bet Type Selection -->
				<div>
					<label class="mb-2 block text-sm font-medium">Bet Type</label>
					<div class="grid grid-cols-2 gap-2">
						{#each Object.entries(BET_TYPES) as [type, info]}
							<Button
								size="sm"
								variant={betType === type ? 'default' : 'outline'}
								onclick={() => handleBetTypeChange(type as BetType)}
								disabled={isSpinning}
							>
								{type.charAt(0).toUpperCase() + type.slice(1)}
								<br />
								<span class="text-xs opacity-75">{info.multiplier}x</span>
							</Button>
						{/each}
					</div>
				</div>

				<!-- Symbol Selection -->
				<div>
					<label class="mb-2 block text-sm font-medium">
						Select Icons ({selectedSymbols.length}/
						{betType === 'single'
							? 1
							: betType === 'pair'
								? 2
								: betType === 'trio'
									? 3
									: 4})
					</label>
					<div class="grid grid-cols-4 gap-2">
						{#each ROULETTE_SYMBOLS as symbol}
							<button
								class="symbol-select-btn {selectedSymbols.includes(symbol)
									? 'selected'
									: ''}"
								onclick={() => toggleSymbol(symbol)}
								disabled={isSpinning}
							>
								<img
									src="/facedev/avif/{symbol}.avif?v={CACHE_VERSION}"
									alt={symbol}
									class="symbol-select-icon"
								/>
							</button>
						{/each}
					</div>
				</div>

				<!-- Bet Amount -->
				<div>
					<label for="bet-amount" class="mb-2 block text-sm font-medium">Bet Amount</label>
					<Input
						id="bet-amount"
						type="text"
						value={betAmountDisplay}
						oninput={handleBetAmountInput}
						onblur={handleBetAmountBlur}
						disabled={isSpinning}
						placeholder="Enter bet amount"
					/>
					<p class="text-muted-foreground mt-1 text-xs">
						Max bet: {MAX_BET_AMOUNT.toLocaleString()}
					</p>
				</div>

				<!-- Percentage Quick Actions -->
				<div>
					<div class="grid grid-cols-4 gap-2">
						<Button
							size="sm"
							variant="outline"
							onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT) * 0.25))}
							disabled={isSpinning}>25%</Button
						>
						<Button
							size="sm"
							variant="outline"
							onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT) * 0.5))}
							disabled={isSpinning}>50%</Button
						>
						<Button
							size="sm"
							variant="outline"
							onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT) * 0.75))}
							disabled={isSpinning}>75%</Button
						>
						<Button
							size="sm"
							variant="outline"
							onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT)))}
							disabled={isSpinning}>Max</Button
						>
					</div>
				</div>

				<!-- Potential Payout -->
				{#if selectedSymbols.length > 0 && betAmount > 0}
					<div class="bg-muted/50 rounded-lg p-3">
						<div class="flex justify-between text-sm">
							<span>Potential Payout:</span>
							<span class="text-success font-semibold">
								{formatValue(betAmount * BET_TYPES[betType].multiplier)}
							</span>
						</div>
						<div class="flex justify-between text-xs text-muted-foreground mt-1">
							<span>Multiplier:</span>
							<span>{BET_TYPES[betType].multiplier}x</span>
						</div>
					</div>
				{/if}

				<!-- Spin Button -->
				<Button class="h-12 w-full text-lg" onclick={spin} disabled={!canBet}>
					{isSpinning ? 'Spinning...' : 'Spin'}
				</Button>
			</div>
		</div>
	</CardContent>
</Card>

<style>
	.roulette-container {
		position: relative;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.roulette-wheel-wrapper {
		position: relative;
		width: 320px;
		height: 320px;
		margin: 0 auto;
		background: radial-gradient(circle, var(--muted) 0%, var(--background) 100%);
		border-radius: 50%;
		padding: 10px;
		box-shadow: 
			inset 0 4px 20px rgba(0, 0, 0, 0.2),
			0 8px 30px rgba(0, 0, 0, 0.3);
	}

	.roulette-wheel {
		position: relative;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		background: conic-gradient(
			from 0deg,
			#1e293b 0deg 45deg,
			#334155 45deg 90deg,
			#1e293b 90deg 135deg,
			#334155 135deg 180deg,
			#1e293b 180deg 225deg,
			#334155 225deg 270deg,
			#1e293b 270deg 315deg,
			#334155 315deg 360deg
		);
		border: 10px solid var(--border);
		box-shadow: 
			0 0 30px rgba(0, 0, 0, 0.4),
			inset 0 0 30px rgba(0, 0, 0, 0.2),
			0 4px 20px rgba(0, 0, 0, 0.3),
			inset 0 2px 10px rgba(255, 255, 255, 0.05);
		transform-origin: center;
		overflow: visible;
	}

	.wheel-center {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 60px;
		height: 60px;
		border-radius: 50%;
		background: radial-gradient(circle, var(--card) 0%, var(--muted) 100%);
		border: 4px solid var(--border);
		box-shadow: 
			inset 0 2px 10px rgba(0, 0, 0, 0.3),
			0 2px 10px rgba(0, 0, 0, 0.2);
		z-index: 5;
	}

	.wheel-symbol {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 70px;
		height: 70px;
		margin-left: -35px;
		margin-top: -35px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.symbol-slot {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--card) 0%, var(--muted) 100%);
		border: 4px solid var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.3s ease;
		box-shadow: 
			0 4px 12px rgba(0, 0, 0, 0.3),
			inset 0 2px 6px rgba(255, 255, 255, 0.1);
		backdrop-filter: blur(4px);
	}

	.symbol-slot.selected {
		border-color: var(--primary);
		background: linear-gradient(135deg, var(--primary) 0%, hsl(var(--primary) / 0.8) 100%);
		box-shadow: 
			0 0 20px var(--primary),
			0 4px 12px rgba(0, 0, 0, 0.3),
			inset 0 2px 6px rgba(255, 255, 255, 0.2);
		transform: scale(1.15);
		z-index: 10;
	}

	.symbol-slot.winning {
		border-color: var(--success);
		background: linear-gradient(135deg, var(--success) 0%, hsl(var(--success) / 0.8) 100%);
		box-shadow: 
			0 0 30px var(--success),
			0 4px 12px rgba(0, 0, 0, 0.3),
			inset 0 2px 6px rgba(255, 255, 255, 0.3);
		animation: win-pulse 0.5s ease-in-out infinite;
		z-index: 15;
	}

	@keyframes win-pulse {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.2);
		}
	}

	.symbol-icon {
		width: 45px;
		height: 45px;
		object-fit: contain;
		object-position: center;
		filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.4));
		transition: transform 0.3s ease;
		display: block;
		margin: 0 auto;
	}

	.symbol-slot.selected .symbol-icon,
	.symbol-slot.winning .symbol-icon {
		transform: scale(1.1);
		filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.5)) brightness(1.1);
	}

	.roulette-pointer {
		position: absolute;
		top: -15px;
		left: 50%;
		transform: translateX(-50%);
		width: 0;
		height: 0;
		border-left: 20px solid transparent;
		border-right: 20px solid transparent;
		border-top: 40px solid var(--destructive);
		z-index: 20;
		filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.6));
		animation: pointer-pulse 2s ease-in-out infinite;
	}

	@keyframes pointer-pulse {
		0%, 100% {
			transform: translateX(-50%) scale(1);
		}
		50% {
			transform: translateX(-50%) scale(1.05);
		}
	}

	.roulette-pointer::before {
		content: '';
		position: absolute;
		top: -45px;
		left: -12px;
		width: 24px;
		height: 24px;
		background: radial-gradient(circle, var(--destructive) 0%, hsl(var(--destructive) / 0.8) 100%);
		border-radius: 50%;
		border: 4px solid var(--background);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
	}

	.roulette-pointer::after {
		content: '';
		position: absolute;
		top: -41px;
		left: -8px;
		width: 16px;
		height: 16px;
		background: rgba(255, 255, 255, 0.3);
		border-radius: 50%;
	}

	.symbol-select-btn {
		aspect-ratio: 1;
		border: 2px solid var(--border);
		border-radius: var(--radius);
		background: var(--card);
		cursor: pointer;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
	}

	.symbol-select-btn:hover:not(:disabled) {
		border-color: var(--primary);
		background: var(--accent);
		transform: scale(1.05);
	}

	.symbol-select-btn.selected {
		border-color: var(--primary);
		background: var(--primary);
		box-shadow: 0 0 10px var(--primary);
	}

	.symbol-select-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.symbol-select-icon {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
</style>
