<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Gift, Clock, Loader2, CheckIcon, Zap } from 'lucide-svelte';
	import { USER_DATA } from '$lib/stores/user-data';
	import { fetchPortfolioSummary } from '$lib/stores/portfolio-data';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { formatTimeRemaining } from '$lib/utils';

	interface RewardStatus {
		// Daily
		canClaim: boolean;
		rewardAmount: number;
		baseReward: number;
		prestigeBonus?: number;
		prestigeLevel?: number;
		timeRemaining: number;
		nextClaimTime: string | null;
		// Hourly
		canClaimHourly: boolean;
		hourlyRewardAmount: number;
		hourlyBaseReward: number;
		hourlyPrestigeBonus?: number;
		hourlyTimeRemaining: number;
		nextHourlyClaimTime: string | null;
		// Common
		totalRewardsClaimed: number;
		lastRewardClaim: string | null;
		lastHourlyRewardClaim: string | null;
		loginStreak: number;
	}

	type ClaimState = 'idle' | 'loading' | 'success';

	let rewardStatus = $state<RewardStatus | null>(null);
	let dailyClaimState = $state<ClaimState>('idle');
	let hourlyClaimState = $state<ClaimState>('idle');
	let error = $state<string | null>(null);

	$effect(() => {
		if ($USER_DATA) {
			fetchRewardStatus();
			const interval = setInterval(() => {
				fetchRewardStatus();
			}, 60000);

			return () => clearInterval(interval);
		}
	});

	async function fetchRewardStatus() {
		try {
			const response = await fetch('/api/rewards/claim');
			if (response.ok) {
				rewardStatus = await response.json();
				error = null;
			} else {
				error = 'Failed to fetch reward status';
			}
		} catch (err) {
			error = 'Network error';
			console.error('Error fetching reward status:', err);
		}
	}

	async function claimDailyReward() {
		if (!rewardStatus?.canClaim || dailyClaimState === 'loading') return;

		dailyClaimState = 'loading';
		error = null;

		try {
			const response = await fetch('/api/rewards/claim', {
				method: 'POST'
			});

			if (response.ok) {
				const result = await response.json();
				dailyClaimState = 'success';

				const prestigeBonus = result.prestigeBonus || 0;
				const hasPrestigeBonus = prestigeBonus > 0;

				toast.success(`Daily reward claimed! +$${formatCurrency(result.rewardAmount)}`, {
					description: hasPrestigeBonus 
						? `Base: $${formatCurrency(result.baseReward)} + Prestige bonus: $${formatCurrency(prestigeBonus)} | Streak: ${result.loginStreak} days 🔥`
						: result.loginStreak > 0
							? `Login streak: ${result.loginStreak} days 🔥`
							: undefined,
					action: {
						label: 'View Portfolio',
						onClick: () => {
							goto('/portfolio');
						}
					}
				});

				if ($USER_DATA) {
					await fetchPortfolioSummary();
				}

				await fetchRewardStatus();

				setTimeout(() => {
					dailyClaimState = 'idle';
				}, 1000);
			} else {
				const errorData = await response.json();
				if (response.status === 429 && errorData.timeRemaining) {
					await fetchRewardStatus();

					const hours = Math.floor(errorData.timeRemaining / (60 * 60 * 1000));
					const minutes = Math.floor((errorData.timeRemaining % (60 * 60 * 1000)) / (60 * 1000));
					const timeText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

					toast.info('Daily reward on cooldown', {
						description: `Next reward available in ${timeText}`
					});
				} else {
					error = errorData.error || errorData.message || 'Failed to claim reward';
					toast.error('Failed to claim reward');
				}
			}
		} catch (err) {
			error = 'Network error';
			toast.error('Network error', {
				description: 'Please check your connection and try again.'
			});
			console.error('Error claiming reward:', err);
		} finally {
			if (dailyClaimState !== 'success') {
				dailyClaimState = 'idle';
			}
		}
	}

	async function claimHourlyReward() {
		if (!rewardStatus?.canClaimHourly || hourlyClaimState === 'loading') return;

		hourlyClaimState = 'loading';
		error = null;

		try {
			const response = await fetch('/api/rewards/hourly', {
				method: 'POST'
			});

			if (response.ok) {
				const result = await response.json();
				hourlyClaimState = 'success';

				const prestigeBonus = result.prestigeBonus || 0;
				const hasPrestigeBonus = prestigeBonus > 0;

				toast.success(`Hourly reward claimed! +$${formatCurrency(result.rewardAmount)}`, {
					description: hasPrestigeBonus 
						? `Base: $${formatCurrency(result.baseReward)} + Prestige: $${formatCurrency(prestigeBonus)}`
						: undefined,
					action: {
						label: 'View Portfolio',
						onClick: () => {
							goto('/portfolio');
						}
					}
				});

				if ($USER_DATA) {
					await fetchPortfolioSummary();
				}

				await fetchRewardStatus();

				setTimeout(() => {
					hourlyClaimState = 'idle';
				}, 1000);
			} else {
				const errorData = await response.json();
				if (response.status === 429 && errorData.timeRemaining) {
					await fetchRewardStatus();

					const minutes = Math.floor(errorData.timeRemaining / (60 * 1000));
					const seconds = Math.floor((errorData.timeRemaining % (60 * 1000)) / 1000);
					const timeText = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

					toast.info('Hourly reward on cooldown', {
						description: `Next reward available in ${timeText}`
					});
				} else {
					error = errorData.error || errorData.message || 'Failed to claim reward';
					toast.error('Failed to claim hourly reward');
				}
			}
		} catch (err) {
			error = 'Network error';
			toast.error('Network error', {
				description: 'Please check your connection and try again.'
			});
			console.error('Error claiming hourly reward:', err);
		} finally {
			if (hourlyClaimState !== 'success') {
				hourlyClaimState = 'idle';
			}
		}
	}

	function formatCurrency(value: number): string {
		return value.toLocaleString('en-US', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		});
	}
</script>

<div class="flex flex-col gap-1.5">
	<!-- Daily Reward Button -->
	<Button
		onclick={claimDailyReward}
		disabled={dailyClaimState === 'loading' || !rewardStatus?.canClaim}
		class="w-full transition-all duration-300"
		size="sm"
		variant={dailyClaimState === 'success' ? 'secondary' : rewardStatus?.canClaim ? 'default' : 'outline'}
	>
		{#if !rewardStatus || dailyClaimState === 'loading'}
			<Loader2 class="h-4 w-4 animate-spin" />
			<span>{!rewardStatus ? 'Loading...' : 'Claiming...'}</span>
		{:else if dailyClaimState === 'success'}
			<CheckIcon class="h-4 w-4" />
			<span>Claimed!</span>
		{:else if rewardStatus.canClaim}
			<Gift class="h-4 w-4" />
			<span>Daily ${formatCurrency(rewardStatus.rewardAmount)}</span>
		{:else}
			<Clock class="h-4 w-4" />
			<span>Daily: {formatTimeRemaining(rewardStatus.timeRemaining)}</span>
		{/if}
	</Button>

	<!-- Hourly Reward Button -->
	<Button
		onclick={claimHourlyReward}
		disabled={hourlyClaimState === 'loading' || !rewardStatus?.canClaimHourly}
		class="w-full transition-all duration-300"
		size="sm"
		variant={hourlyClaimState === 'success' ? 'secondary' : rewardStatus?.canClaimHourly ? 'default' : 'outline'}
	>
		{#if !rewardStatus || hourlyClaimState === 'loading'}
			<Loader2 class="h-4 w-4 animate-spin" />
			<span>{!rewardStatus ? 'Loading...' : 'Claiming...'}</span>
		{:else if hourlyClaimState === 'success'}
			<CheckIcon class="h-4 w-4" />
			<span>Claimed!</span>
		{:else if rewardStatus.canClaimHourly}
			<Zap class="h-4 w-4" />
			<span>Hourly ${formatCurrency(rewardStatus.hourlyRewardAmount)}</span>
		{:else}
			<Clock class="h-4 w-4" />
			<span>Hourly: {formatTimeRemaining(rewardStatus.hourlyTimeRemaining)}</span>
		{/if}
	</Button>
</div>
