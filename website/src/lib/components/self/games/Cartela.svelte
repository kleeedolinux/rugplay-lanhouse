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

	async function play() {
		if (!canBet) return;

		isPlaying = true;
		lastResult = null;
		isRevealing = true;
		revealedCount = 0;

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
				await new Promise(resolve => setTimeout(resolve, 400));
				revealedCount = i + 1;
				playSound('click');
			}

			await new Promise(resolve => setTimeout(resolve, 500));

			balance = result.newBalance;
			lastResult = result;
			onBalanceUpdate?.(result.newBalance);

			if (result.won) {
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

<Card>
	<CardHeader>
		<CardTitle>Cartela</CardTitle>
		<CardDescription>Pick your programming language and test your luck! Based on Jogo do Bicho.</CardDescription>
	</CardHeader>
	<CardContent>
		<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
			<!-- Left Side: Game Display -->
			<div class="space-y-4">
				<!-- Balance Display -->
				<div class="text-center">
					<p class="text-muted-foreground text-sm">Balance</p>
					<p class="text-2xl font-bold">{formatValue(balance)}</p>
				</div>

				<!-- Draw Results Display -->
				<div class="bg-muted/30 rounded-lg border p-4">
					<h3 class="mb-3 text-center text-sm font-semibold">Draw Results</h3>
					<div class="grid grid-cols-5 gap-2">
						{#each Array(5) as _, i}
							<div class="flex flex-col items-center">
								<div class="bg-card flex h-16 w-full items-center justify-center rounded-lg border-2 {lastResult && revealedCount > i ? (lastResult.won && (selectedBetType === 'group' ? lastResult.drawnGroups[i].id === selectedGroup : selectedGroups.includes(lastResult.drawnGroups[i].id)) ? 'border-green-500 bg-green-500/10' : 'border-border') : 'border-border'}">
									{#if isRevealing && revealedCount > i && lastResult}
										<div class="flex flex-col items-center">
											<img src={lastResult.drawnGroups[i].icon} alt={lastResult.drawnGroups[i].name} class="h-8 w-8" />
											<div class="text-[10px] font-bold">{lastResult.drawResults[i].toString().padStart(4, '0')}</div>
										</div>
									{:else if !isPlaying && lastResult && revealedCount > i}
										<div class="flex flex-col items-center">
											<img src={lastResult.drawnGroups[i].icon} alt={lastResult.drawnGroups[i].name} class="h-8 w-8" />
											<div class="text-[10px] font-bold">{lastResult.drawResults[i].toString().padStart(4, '0')}</div>
										</div>
									{:else}
										<div class="text-2xl text-muted-foreground">?</div>
									{/if}
								</div>
								<span class="text-muted-foreground mt-1 text-[10px]">{i + 1}º</span>
							</div>
						{/each}
					</div>
				</div>

				<!-- Result Display -->
				{#if lastResult && !isPlaying}
					<div class="bg-muted/50 rounded-lg p-4 text-center">
						{#if lastResult.won}
							<p class="text-success text-lg font-bold">🎉 YOU WON! 🎉</p>
							<p class="text-sm">
								Payout: {formatValue(lastResult.payout)} ({lastResult.multiplier}x)
							</p>
						{:else}
							<p class="text-destructive font-semibold">No match</p>
							<p class="text-muted-foreground text-sm">
								Lost {formatValue(lastResult.amountWagered)}
							</p>
						{/if}
					</div>
				{/if}

				<!-- Groups Grid -->
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-semibold">Programming Languages</h3>
						{#if selectedBetType === 'duque_group'}
							<Badge variant="outline">Select 2</Badge>
						{:else if selectedBetType === 'terno_group'}
							<Badge variant="outline">Select 3</Badge>
						{/if}
					</div>
					<div class="grid grid-cols-5 gap-1.5">
						{#each groups as group}
							{@const isSelected = selectedBetType === 'group' 
								? selectedGroup === group.id 
								: selectedGroups.includes(group.id)}
							<button
								class="group-btn flex flex-col items-center rounded-lg border p-1.5 text-center transition-all hover:bg-muted/50 {isSelected ? 'border-primary bg-primary/10' : 'border-border'}"
								onclick={() => toggleGroupSelection(group.id)}
								disabled={isPlaying || !['group', 'duque_group', 'terno_group'].includes(selectedBetType)}
							>
								<img src={group.icon} alt={group.name} class="h-6 w-6" />
								<span class="text-[9px] font-medium leading-tight">{group.name}</span>
								<span class="text-muted-foreground text-[8px]">{group.numbers.join('-')}</span>
							</button>
						{/each}
					</div>
				</div>
			</div>

			<!-- Right Side: Betting Controls -->
			<div class="space-y-4">
				<!-- Bet Type Selection -->
				<div>
					<label class="mb-2 block text-sm font-medium">Bet Type</label>
					<Select.Root type="single" bind:value={selectedBetType} onValueChange={() => resetSelection()}>
						<Select.Trigger class="w-full">
							{betTypes.find(bt => bt.type === selectedBetType)?.description || 'Select bet type'}
						</Select.Trigger>
						<Select.Content>
							{#each betTypes as bt}
								<Select.Item value={bt.type}>
									<div class="flex items-center justify-between gap-4">
										<span>{bt.description}</span>
										<Badge variant="secondary">{bt.multiplier}x</Badge>
									</div>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<!-- Number Input (for dozen/hundred/thousand) -->
				{#if ['dozen', 'hundred', 'thousand'].includes(selectedBetType)}
					<div>
						<label class="mb-2 block text-sm font-medium">
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
						/>
					</div>
				{/if}

				<!-- Selection Display -->
				{#if selectedBetType === 'group' && selectedGroup}
					{@const selectedGroupData = groups.find(g => g.id === selectedGroup)}
					<div class="bg-muted/30 rounded-lg p-3">
						<p class="text-sm font-medium">Selected:</p>
						<div class="mt-1 flex items-center gap-2">
							{#if selectedGroupData}
								<img src={selectedGroupData.icon} alt={selectedGroupData.name} class="h-6 w-6" />
								<span>{selectedGroupData.name}</span>
							{/if}
						</div>
					</div>
				{:else if (selectedBetType === 'duque_group' || selectedBetType === 'terno_group') && selectedGroups.length > 0}
					<div class="bg-muted/30 rounded-lg p-3">
						<p class="text-sm font-medium">Selected ({selectedGroups.length}/{selectedBetType === 'duque_group' ? 2 : 3}):</p>
						<div class="mt-1 flex flex-wrap gap-2">
							{#each selectedGroups as groupId}
								{@const group = groups.find(g => g.id === groupId)}
								{#if group}
									<Badge variant="secondary" class="flex items-center gap-1">
										<img src={group.icon} alt={group.name} class="h-4 w-4" />
										{group.name}
									</Badge>
								{/if}
							{/each}
						</div>
					</div>
				{/if}

				<!-- Potential Win -->
				<div class="bg-muted/30 rounded-lg p-3">
					<div class="flex items-center justify-between">
						<span class="text-sm">Potential Win:</span>
						<span class="text-success font-bold">{formatValue(betAmount * currentMultiplier)}</span>
					</div>
					<div class="text-muted-foreground mt-1 text-xs">
						Multiplier: {currentMultiplier}x
					</div>
				</div>

				<!-- Bet Amount -->
				<div>
					<label class="mb-2 block text-sm font-medium">Bet Amount</label>
					<Input
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

				<!-- Quick Bet Buttons -->
				<div class="grid grid-cols-4 gap-2">
					<Button
						size="sm"
						variant="outline"
						onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT) * 0.25))}
						disabled={isPlaying}
					>25%</Button>
					<Button
						size="sm"
						variant="outline"
						onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT) * 0.5))}
						disabled={isPlaying}
					>50%</Button>
					<Button
						size="sm"
						variant="outline"
						onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT) * 0.75))}
						disabled={isPlaying}
					>75%</Button>
					<Button
						size="sm"
						variant="outline"
						onclick={() => setBetAmount(Math.floor(Math.min(balance, MAX_BET_AMOUNT)))}
						disabled={isPlaying}
					>Max</Button>
				</div>

				<!-- Play Button -->
				<Button class="h-12 w-full text-lg" onclick={play} disabled={!canBet || !isValidBet()}>
					{isPlaying ? 'Drawing...' : 'Play Cartela'}
				</Button>

				<!-- Paytable -->
				<div class="bg-muted/30 rounded-lg p-3">
					<h4 class="mb-2 text-sm font-semibold">Paytable</h4>
					<div class="space-y-1 text-xs">
						{#each betTypes as bt}
							<div class="flex justify-between">
								<span class="text-muted-foreground">{bt.type.replace('_', ' ')}:</span>
								<span class="text-success font-medium">{bt.multiplier}x</span>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>
	</CardContent>
</Card>

<style>
	.group-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
