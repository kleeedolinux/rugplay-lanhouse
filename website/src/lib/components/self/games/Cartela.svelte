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
	import * as Select from '$lib/components/ui/select';
	import { Badge } from '$lib/components/ui/badge';
	import confetti from 'canvas-confetti';
	import { toast } from 'svelte-sonner';
	import { formatValue, playSound, showConfetti, showSchoolPrideCannons } from '$lib/utils';
	import { volumeSettings } from '$lib/stores/volume-settings';
	import { onMount } from 'svelte';
	import { fetchPortfolioSummary } from '$lib/stores/portfolio-data';
	import { Sparkles, Trophy, Zap } from 'lucide-svelte';

	interface ProgrammingGroup {
		id: number;
		name: string;
		icon: string;
		numbers: number[];
	}

	interface BetTypeInfo {
		type: string;
		multiplier: number;
		description: string;
	}

	interface CartelaResult {
		won: boolean;
		drawResults: number[];
		drawnGroups: { id: number; name: string; icon: string }[];
		newBalance: number;
		payout: number;
		amountWagered: number;
		multiplier: number;
		betType: string;
		betValue: number | number[];
	}

	let {
		balance = $bindable(),
		onBalanceUpdate
	}: {
		balance: number;
		onBalanceUpdate?: (newBalance: number) => void;
	} = $props();

	const MAX_BET_AMOUNT = 100000;

	let groups: ProgrammingGroup[] = $state([]);
	let betTypes: BetTypeInfo[] = $state([]);
	let betAmount = $state(10);
	let betAmountDisplay = $state('10');
	let isPlaying = $state(false);
	let lastResult = $state<CartelaResult | null>(null);
	let isRevealing = $state(false);
	let revealedCount = $state(0);
	let showWinAnimation = $state(false);

	// Bet selection state
	let selectedBetType = $state('group');
	let selectedGroup = $state<number | null>(null);
	let selectedGroups = $state<number[]>([]);
	let numberInput = $state('');

	let canBet = $derived(
		betAmount > 0 &&
		betAmount <= balance &&
		betAmount <= MAX_BET_AMOUNT &&
		!isPlaying &&
		isValidBet
	);

	let isValidBet = $derived(() => {
		if (selectedBetType === 'group') return selectedGroup !== null;
		if (selectedBetType === 'duque_group') return selectedGroups.length === 2;
		if (selectedBetType === 'terno_group') return selectedGroups.length === 3;
		if (['dozen', 'hundred', 'thousand'].includes(selectedBetType)) {
			const num = parseInt(numberInput);
			if (selectedBetType === 'dozen') return !isNaN(num) && num >= 0 && num <= 99;
			if (selectedBetType === 'hundred') return !isNaN(num) && num >= 0 && num <= 999;
			if (selectedBetType === 'thousand') return !isNaN(num) && num >= 0 && num <= 9999;
		}
		return false;
	});

	let currentMultiplier = $derived(
		betTypes.find(bt => bt.type === selectedBetType)?.multiplier || 0
	);

	function setBetAmount(amount: number) {
		const clampedAmount = Math.min(amount, Math.min(balance, MAX_BET_AMOUNT));
		if (clampedAmount >= 0) {
			betAmount = clampedAmount;
			betAmountDisplay = clampedAmount.toLocaleString();
		}
	}

	function handleBetAmountInput(event: Event) {
		const target = event.target as HTMLInputElement;
		const value = target.value.replace(/,/g, '');
		const numValue = parseFloat(value) || 0;
		const clampedValue = Math.min(numValue, Math.min(balance, MAX_BET_AMOUNT));

		betAmount = clampedValue;
		betAmountDisplay = target.value;
	}

	function handleBetAmountBlur() {
		betAmountDisplay = betAmount.toLocaleString();
	}

	function toggleGroupSelection(groupId: number) {
		if (selectedBetType === 'group') {
			selectedGroup = selectedGroup === groupId ? null : groupId;
		} else if (selectedBetType === 'duque_group') {
			if (selectedGroups.includes(groupId)) {
				selectedGroups = selectedGroups.filter(g => g !== groupId);
			} else if (selectedGroups.length < 2) {
				selectedGroups = [...selectedGroups, groupId];
			}
		} else if (selectedBetType === 'terno_group') {
			if (selectedGroups.includes(groupId)) {
				selectedGroups = selectedGroups.filter(g => g !== groupId);
			} else if (selectedGroups.length < 3) {
				selectedGroups = [...selectedGroups, groupId];
			}
		}
	}

	function resetSelection() {
		selectedGroup = null;
		selectedGroups = [];
		numberInput = '';
	}

	function getBetValue(): number | number[] {
		if (selectedBetType === 'group') return selectedGroup!;
		if (selectedBetType === 'duque_group' || selectedBetType === 'terno_group') return selectedGroups;
		return parseInt(numberInput);
	}

	function isWinningGroup(groupId: number): boolean {
		if (!lastResult || !lastResult.won) return false;
		if (selectedBetType === 'group') {
			return lastResult.drawnGroups[0].id === groupId && groupId === selectedGroup;
		}
		if (selectedBetType === 'duque_group' || selectedBetType === 'terno_group') {
			return lastResult.drawnGroups.some(g => g.id === groupId) && selectedGroups.includes(groupId);
		}
		return false;
	}

	async function play() {
		if (!canBet) return;

		isPlaying = true;
		lastResult = null;
		isRevealing = true;
		revealedCount = 0;
		showWinAnimation = false;

		playSound('dice');

		try {
			const response = await fetch('/api/gambling/cartela', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					amount: betAmount,
					betType: selectedBetType,
					betValue: getBetValue()
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || 'Failed to place bet');
			}

			const result: CartelaResult = await response.json();

			// Reveal animation - show results one by one
			for (let i = 0; i < 5; i++) {
				await new Promise(resolve => setTimeout(resolve, 500));
				revealedCount = i + 1;
				playSound('click');
			}

			await new Promise(resolve => setTimeout(resolve, 600));

			balance = result.newBalance;
			lastResult = result;
			onBalanceUpdate?.(result.newBalance);

			if (result.won) {
				showWinAnimation = true;
				showSchoolPrideCannons(confetti);
				showConfetti(confetti);
				playSound('win');
			} else {
				playSound('lose');
			}

			isRevealing = false;
			isPlaying = false;
		} catch (error) {
			console.error('Cartela error:', error);
			toast.error('Bet failed', {
				description: error instanceof Error ? error.message : 'Unknown error occurred'
			});
			isPlaying = false;
			isRevealing = false;
		}
	}

	async function loadGameData() {
		try {
			const response = await fetch('/api/gambling/cartela');
			if (response.ok) {
				const data = await response.json();
				groups = data.groups;
				betTypes = data.betTypes;
			}
		} catch (error) {
			console.error('Failed to load cartela data:', error);
		}
	}

	onMount(async () => {
		volumeSettings.load();
		await loadGameData();

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

<Card class="cartela-card overflow-hidden">
	<CardHeader class="cartela-header relative">
		<div class="absolute inset-0 bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-orange-500/10"></div>
		<div class="relative flex items-center gap-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg">
				<Sparkles class="h-5 w-5 text-white" />
			</div>
			<div>
				<CardTitle class="text-xl">Cartela</CardTitle>
				<CardDescription>Pick your programming language and test your luck!</CardDescription>
			</div>
		</div>
	</CardHeader>
	<CardContent class="p-4 md:p-6">
		<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
			<!-- Left Side: Game Display -->
			<div class="space-y-4">
				<!-- Balance Display -->
				<div class="balance-display rounded-xl border bg-gradient-to-br from-muted/50 to-muted p-4 text-center">
					<p class="text-muted-foreground text-xs uppercase tracking-wider">Your Balance</p>
					<p class="bg-gradient-to-r from-green-400 to-emerald-500 bg-clip-text text-3xl font-bold text-transparent">
						{formatValue(balance)}
					</p>
				</div>

				<!-- Draw Results Display -->
				<div class="draw-machine relative overflow-hidden rounded-xl border-2 border-primary/20 bg-gradient-to-b from-card to-muted/30 p-4">
					<div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent"></div>
					
					<div class="relative">
						<div class="mb-4 flex items-center justify-center gap-2">
							<div class="h-px flex-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent"></div>
							<h3 class="text-sm font-bold uppercase tracking-widest text-primary/80">Draw Results</h3>
							<div class="h-px flex-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent"></div>
						</div>
						
						<div class="grid grid-cols-5 gap-2">
							{#each Array(5) as _, i}
								{@const isWinner = lastResult && revealedCount > i && lastResult.won && 
									(selectedBetType === 'group' 
										? lastResult.drawnGroups[i].id === selectedGroup 
										: selectedGroups.includes(lastResult.drawnGroups[i].id))}
								<div class="flex flex-col items-center">
									<div 
										class="result-card relative flex h-20 w-full flex-col items-center justify-center rounded-xl border-2 transition-all duration-300
											{revealedCount > i ? 'revealed' : 'unrevealed'}
											{isWinner ? 'winner border-green-500 bg-green-500/20 shadow-lg shadow-green-500/20' : 'border-border bg-card/80'}"
									>
										{#if isRevealing && revealedCount > i && lastResult}
											<div class="result-content flex flex-col items-center gap-1">
												<img 
													src={lastResult.drawnGroups[i].icon} 
													alt={lastResult.drawnGroups[i].name} 
													class="h-9 w-9 drop-shadow-md transition-transform hover:scale-110" 
												/>
												<div class="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px] font-bold backdrop-blur-sm">
													{lastResult.drawResults[i].toString().padStart(4, '0')}
												</div>
											</div>
										{:else if !isPlaying && lastResult && revealedCount > i}
											<div class="result-content flex flex-col items-center gap-1">
												<img 
													src={lastResult.drawnGroups[i].icon} 
													alt={lastResult.drawnGroups[i].name} 
													class="h-9 w-9 drop-shadow-md transition-transform hover:scale-110" 
												/>
												<div class="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px] font-bold backdrop-blur-sm">
													{lastResult.drawResults[i].toString().padStart(4, '0')}
												</div>
											</div>
										{:else}
											<div class="question-mark text-3xl font-bold text-muted-foreground/50">?</div>
										{/if}
										
										{#if isWinner}
											<div class="absolute -right-1 -top-1">
												<div class="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 shadow-lg">
													<Trophy class="h-3 w-3 text-white" />
												</div>
											</div>
										{/if}
									</div>
									<Badge variant="outline" class="mt-1.5 text-[10px] {i === 0 ? 'border-yellow-500/50 text-yellow-600' : ''}">
										{i + 1}º
									</Badge>
								</div>
							{/each}
						</div>
					</div>
				</div>

				<!-- Result Display -->
				{#if lastResult && !isPlaying}
					<div class="result-banner overflow-hidden rounded-xl border-2 {lastResult.won ? 'border-green-500/50 bg-gradient-to-r from-green-500/20 via-emerald-500/20 to-green-500/20' : 'border-red-500/30 bg-gradient-to-r from-red-500/10 via-red-500/5 to-red-500/10'} p-4 text-center">
						{#if lastResult.won}
							<div class="win-display">
								<div class="mb-2 flex items-center justify-center gap-2">
									<Sparkles class="h-5 w-5 text-yellow-500 animate-pulse" />
									<p class="text-xl font-black uppercase tracking-wide text-green-500">You Won!</p>
									<Sparkles class="h-5 w-5 text-yellow-500 animate-pulse" />
								</div>
								<p class="text-2xl font-bold text-green-400">
									+{formatValue(lastResult.payout)}
								</p>
								<Badge variant="secondary" class="mt-2 bg-green-500/20 text-green-400">
									{lastResult.multiplier}x Multiplier
								</Badge>
							</div>
						{:else}
							<p class="text-lg font-bold text-red-400">No Match</p>
							<p class="text-muted-foreground text-sm">
								Lost {formatValue(lastResult.amountWagered)}
							</p>
						{/if}
					</div>
				{/if}

				<!-- Groups Grid -->
				<div class="groups-section space-y-3">
					<div class="flex items-center justify-between">
						<h3 class="flex items-center gap-2 text-sm font-bold">
							<Zap class="h-4 w-4 text-primary" />
							Select Language
						</h3>
						{#if selectedBetType === 'duque_group'}
							<Badge variant="outline" class="animate-pulse border-primary/50">Select 2</Badge>
						{:else if selectedBetType === 'terno_group'}
							<Badge variant="outline" class="animate-pulse border-primary/50">Select 3</Badge>
						{/if}
					</div>
					<div class="grid grid-cols-5 gap-1.5">
						{#each groups as group, idx}
							{@const isSelected = selectedBetType === 'group' 
								? selectedGroup === group.id 
								: selectedGroups.includes(group.id)}
							{@const isWinner = isWinningGroup(group.id)}
							<button
								class="group-btn relative flex flex-col items-center rounded-lg border p-2 text-center transition-all duration-200
									{isSelected ? 'selected border-primary bg-primary/15 shadow-md shadow-primary/20' : 'border-border/50 bg-card/50 hover:border-primary/30 hover:bg-muted/50'}
									{isWinner ? 'winner-group' : ''}"
								onclick={() => toggleGroupSelection(group.id)}
								disabled={isPlaying || !['group', 'duque_group', 'terno_group'].includes(selectedBetType)}
								style="animation-delay: {idx * 20}ms"
							>
								<img 
									src={group.icon} 
									alt={group.name} 
									class="h-7 w-7 transition-transform duration-200 {isSelected ? 'scale-110' : 'group-btn:hover:scale-105'}" 
								/>
								<span class="mt-0.5 text-[8px] font-semibold leading-tight {isSelected ? 'text-primary' : 'text-muted-foreground'}">
									{group.name}
								</span>
								<span class="font-mono text-[7px] text-muted-foreground/70">
									{group.numbers[0].toString().padStart(2, '0')}-{group.numbers[3].toString().padStart(2, '0')}
								</span>
								
								{#if isSelected}
									<div class="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow">
										✓
									</div>
								{/if}
							</button>
						{/each}
					</div>
				</div>
			</div>

			<!-- Right Side: Betting Controls -->
			<div class="space-y-4">
				<!-- Bet Type Selection -->
				<div class="rounded-xl border bg-card/50 p-4">
					<label class="mb-2 flex items-center gap-2 text-sm font-bold">
						<span class="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-xs">1</span>
						Choose Bet Type
					</label>
					<Select.Root type="single" bind:value={selectedBetType} onValueChange={() => resetSelection()}>
						<Select.Trigger class="w-full border-primary/20 bg-background">
							{betTypes.find(bt => bt.type === selectedBetType)?.description || 'Select bet type'}
						</Select.Trigger>
						<Select.Content>
							{#each betTypes as bt}
								<Select.Item value={bt.type}>
									<div class="flex w-full items-center justify-between gap-4">
										<span class="text-sm">{bt.description}</span>
										<Badge variant="secondary" class="bg-primary/20 text-primary">{bt.multiplier}x</Badge>
									</div>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<!-- Number Input (for dozen/hundred/thousand) -->
				{#if ['dozen', 'hundred', 'thousand'].includes(selectedBetType)}
					<div class="rounded-xl border bg-card/50 p-4">
						<label class="mb-2 flex items-center gap-2 text-sm font-bold">
							<span class="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-xs">2</span>
							{#if selectedBetType === 'dozen'}
								Enter 2 digits (00-99)
							{:else if selectedBetType === 'hundred'}
								Enter 3 digits (000-999)
							{:else}
								Enter 4 digits (0000-9999)
							{/if}
						</label>
						<Input
							type="text"
							bind:value={numberInput}
							placeholder={selectedBetType === 'dozen' ? '00' : selectedBetType === 'hundred' ? '000' : '0000'}
							maxlength={selectedBetType === 'dozen' ? 2 : selectedBetType === 'hundred' ? 3 : 4}
							disabled={isPlaying}
							class="font-mono text-lg tracking-widest"
						/>
					</div>
				{/if}

				<!-- Selection Display -->
				{#if selectedBetType === 'group' && selectedGroup}
					{@const selectedGroupData = groups.find(g => g.id === selectedGroup)}
					<div class="selection-display rounded-xl border border-primary/30 bg-primary/5 p-3">
						<p class="mb-1 text-xs font-medium text-muted-foreground">Your Pick:</p>
						<div class="flex items-center gap-3">
							{#if selectedGroupData}
								<img src={selectedGroupData.icon} alt={selectedGroupData.name} class="h-10 w-10 drop-shadow" />
								<div>
									<span class="font-bold">{selectedGroupData.name}</span>
									<p class="font-mono text-xs text-muted-foreground">
										Numbers: {selectedGroupData.numbers.join(', ')}
									</p>
								</div>
							{/if}
						</div>
					</div>
				{:else if (selectedBetType === 'duque_group' || selectedBetType === 'terno_group') && selectedGroups.length > 0}
					<div class="selection-display rounded-xl border border-primary/30 bg-primary/5 p-3">
						<p class="mb-2 text-xs font-medium text-muted-foreground">
							Your Picks ({selectedGroups.length}/{selectedBetType === 'duque_group' ? 2 : 3}):
						</p>
						<div class="flex flex-wrap gap-2">
							{#each selectedGroups as groupId}
								{@const group = groups.find(g => g.id === groupId)}
								{#if group}
									<Badge variant="secondary" class="flex items-center gap-1.5 bg-primary/20 px-2 py-1">
										<img src={group.icon} alt={group.name} class="h-5 w-5" />
										<span class="font-medium">{group.name}</span>
									</Badge>
								{/if}
							{/each}
						</div>
					</div>
				{/if}

				<!-- Potential Win -->
				<div class="potential-win overflow-hidden rounded-xl border-2 border-dashed border-green-500/30 bg-gradient-to-r from-green-500/5 to-emerald-500/5 p-4">
					<div class="flex items-center justify-between">
						<div>
							<span class="text-xs font-medium text-muted-foreground">Potential Win</span>
							<p class="text-2xl font-black text-green-500">{formatValue(betAmount * currentMultiplier)}</p>
						</div>
						<div class="text-right">
							<Badge variant="outline" class="border-green-500/50 text-green-500">
								{currentMultiplier}x
							</Badge>
						</div>
					</div>
				</div>

				<!-- Bet Amount -->
				<div class="rounded-xl border bg-card/50 p-4">
					<label class="mb-2 flex items-center gap-2 text-sm font-bold">
						<span class="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-xs">
							{['dozen', 'hundred', 'thousand'].includes(selectedBetType) ? '3' : '2'}
						</span>
						Bet Amount
					</label>
					<Input
						type="text"
						value={betAmountDisplay}
						oninput={handleBetAmountInput}
						onblur={handleBetAmountBlur}
						disabled={isPlaying}
						placeholder="Enter bet amount"
						class="text-lg font-bold"
					/>
					<p class="text-muted-foreground mt-1 text-xs">
						Max: ${MAX_BET_AMOUNT.toLocaleString()}
					</p>
					
					<!-- Quick Bet Buttons -->
					<div class="mt-3 grid grid-cols-4 gap-2">
						<Button
							size="sm"
							variant="outline"
							onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT) * 0.25))}
							disabled={isPlaying}
							class="text-xs"
						>25%</Button>
						<Button
							size="sm"
							variant="outline"
							onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT) * 0.5))}
							disabled={isPlaying}
							class="text-xs"
						>50%</Button>
						<Button
							size="sm"
							variant="outline"
							onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT) * 0.75))}
							disabled={isPlaying}
							class="text-xs"
						>75%</Button>
						<Button
							size="sm"
							variant="outline"
							onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT)))}
							disabled={isPlaying}
							class="text-xs"
						>Max</Button>
					</div>
				</div>

				<!-- Play Button -->
				<Button 
					class="play-button h-14 w-full text-lg font-bold shadow-lg transition-all duration-300 {canBet && isValidBet() ? 'bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500 hover:shadow-xl hover:shadow-pink-500/25' : ''}" 
					onclick={play} 
					disabled={!canBet || !isValidBet()}
				>
					{#if isPlaying}
						<span class="flex items-center gap-2">
							<span class="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
							Drawing...
						</span>
					{:else}
						<span class="flex items-center gap-2">
							<Sparkles class="h-5 w-5" />
							Play Cartela
						</span>
					{/if}
				</Button>

				<!-- Paytable -->
				<div class="paytable rounded-xl border bg-muted/30 p-3">
					<h4 class="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
						<Trophy class="h-3 w-3" />
						Paytable
					</h4>
					<div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
						{#each betTypes as bt}
							<div class="flex items-center justify-between rounded px-1 py-0.5 hover:bg-muted/50">
								<span class="capitalize text-muted-foreground">{bt.type.replace(/_/g, ' ')}</span>
								<span class="font-mono font-bold text-green-500">{bt.multiplier}x</span>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>
	</CardContent>
</Card>

<style>
	.cartela-card {
		background: linear-gradient(135deg, var(--card) 0%, hsl(var(--card) / 0.8) 100%);
	}

	.cartela-header {
		border-bottom: 1px solid hsl(var(--border) / 0.5);
	}

	.group-btn {
		animation: fadeInUp 0.3s ease-out forwards;
		opacity: 0;
	}

	.group-btn.selected {
		transform: translateY(-2px);
	}

	.group-btn.winner-group {
		animation: winPulse 1s ease-in-out infinite;
	}

	.group-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes winPulse {
		0%, 100% {
			box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4);
		}
		50% {
			box-shadow: 0 0 20px 5px rgba(34, 197, 94, 0.2);
		}
	}

	.result-card {
		perspective: 1000px;
	}

	.result-card.unrevealed {
		background: linear-gradient(135deg, hsl(var(--muted)) 0%, hsl(var(--muted) / 0.5) 100%);
	}

	.result-card.revealed {
		animation: flipIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
	}

	.result-card.winner {
		animation: flipIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275), 
		           winGlow 1.5s ease-in-out infinite;
	}

	@keyframes flipIn {
		0% {
			transform: rotateY(90deg) scale(0.8);
			opacity: 0;
		}
		100% {
			transform: rotateY(0) scale(1);
			opacity: 1;
		}
	}

	@keyframes winGlow {
		0%, 100% {
			box-shadow: 0 0 10px rgba(34, 197, 94, 0.3);
		}
		50% {
			box-shadow: 0 0 25px rgba(34, 197, 94, 0.5);
		}
	}

	.question-mark {
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 0.3;
			transform: scale(1);
		}
		50% {
			opacity: 0.6;
			transform: scale(1.1);
		}
	}

	.play-button:not(:disabled):hover {
		transform: translateY(-2px);
	}

	.play-button:not(:disabled):active {
		transform: translateY(0);
	}

	.win-display {
		animation: bounceIn 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275);
	}

	@keyframes bounceIn {
		0% {
			transform: scale(0.5);
			opacity: 0;
		}
		50% {
			transform: scale(1.1);
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}

	.balance-display {
		background: linear-gradient(135deg, hsl(var(--muted) / 0.5) 0%, hsl(var(--muted)) 100%);
	}

	.draw-machine {
		background: linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--muted) / 0.3) 100%);
	}

	.selection-display {
		animation: slideIn 0.3s ease-out;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateX(-10px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
</style>
