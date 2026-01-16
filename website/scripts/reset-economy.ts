/**
 * Economy Reset Script
 * 
 * This script resets all economic data while preserving user accounts.
 * 
 * PRESERVED:
 * - User accounts (id, name, email, username, bio, image, createdAt)
 * - Sessions and authentication
 * 
 * RESET/DELETED:
 * - User balances → reset to $100
 * - Gambling stats → reset to 0
 * - Reward claims → reset
 * - Login streaks → reset
 * - All coins
 * - All transactions
 * - All price history
 * - All user portfolios
 * - All comments and likes
 * - All promo codes and redemptions
 * - All prediction markets and bets
 * - All notifications
 * 
 * Usage: npm run db:reset-economy -- --force
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema';

const {
    user,
    coin,
    transaction,
    priceHistory,
    userPortfolio,
    comment,
    commentLike,
    promoCode,
    promoCodeRedemption,
    predictionQuestion,
    predictionBet,
    notifications
} = schema;

// Use same DATABASE_URL as drizzle.config.ts
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL não está definida no ambiente');
    console.error('   Certifique-se de ter um arquivo .env com DATABASE_URL');
    process.exit(1);
}

// Create connection with same SSL config pattern as db/index.ts
function getSslConfig(dbUrl: string) {
    const requiresSsl = dbUrl.includes('sslmode=require') || 
                        dbUrl.includes('ssl=true') ||
                        dbUrl.includes('amazonaws.com') ||
                        dbUrl.includes('neon.tech') ||
                        dbUrl.includes('supabase.co') ||
                        dbUrl.includes('railway.app') ||
                        dbUrl.includes('render.com') ||
                        dbUrl.includes('squarecloud.app');

    if (requiresSsl) {
        return { rejectUnauthorized: false };
    }
    return false;
}

async function resetEconomy() {
    console.log('🔄 Iniciando reset da economia...\n');

    const sslConfig = getSslConfig(DATABASE_URL!);
    const client = postgres(DATABASE_URL!, { ssl: sslConfig || undefined });
    const db = drizzle(client, { schema });

    try {
        // Count current data before reset
        const [userCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(user);
        const [coinCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(coin);
        const [txCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(transaction);
        const [portfolioCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(userPortfolio);
        const [commentCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(comment);
        const [predictionCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(predictionQuestion);
        const [notificationCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(notifications);

        console.log('📊 Dados atuais:');
        console.log(`   - Usuários: ${userCount.count}`);
        console.log(`   - Moedas: ${coinCount.count}`);
        console.log(`   - Transações: ${txCount.count}`);
        console.log(`   - Portfolios: ${portfolioCount.count}`);
        console.log(`   - Comentários: ${commentCount.count}`);
        console.log(`   - Previsões: ${predictionCount.count}`);
        console.log(`   - Notificações: ${notificationCount.count}`);
        console.log('');

        console.log('🗑️  Deletando dados econômicos...\n');

        // Delete in correct order (respecting foreign keys)
        
        // 1. Delete prediction bets first (references prediction_question and user)
        await db.delete(predictionBet);
        console.log('   ✓ Apostas de previsão deletadas');

        // 2. Delete prediction questions (references user)
        await db.delete(predictionQuestion);
        console.log('   ✓ Perguntas de previsão deletadas');

        // 3. Delete comment likes (references comment and user)
        await db.delete(commentLike);
        console.log('   ✓ Likes de comentários deletados');

        // 4. Delete comments (references coin and user)
        await db.delete(comment);
        console.log('   ✓ Comentários deletados');

        // 5. Delete promo code redemptions (references promo_code and user)
        await db.delete(promoCodeRedemption);
        console.log('   ✓ Resgates de códigos promocionais deletados');

        // 6. Delete promo codes (references user)
        await db.delete(promoCode);
        console.log('   ✓ Códigos promocionais deletados');

        // 7. Delete user portfolios (references user and coin)
        await db.delete(userPortfolio);
        console.log('   ✓ Portfolios de usuários deletados');

        // 8. Delete transactions (references user and coin)
        await db.delete(transaction);
        console.log('   ✓ Transações deletadas');

        // 9. Delete price history (references coin)
        await db.delete(priceHistory);
        console.log('   ✓ Histórico de preços deletado');

        // 10. Delete notifications (references user)
        await db.delete(notifications);
        console.log('   ✓ Notificações deletadas');

        // 11. Delete all coins (now safe, no more references)
        await db.delete(coin);
        console.log('   ✓ Moedas deletadas');

        console.log('');
        console.log('💰 Resetando saldos e estatísticas dos usuários...\n');

        // Reset user economic data while preserving account info
        await db.update(user).set({
            baseCurrencyBalance: '100.00000000',  // Reset to $100
            gamblingLosses: '0.00000000',
            gamblingWins: '0.00000000',
            totalRewardsClaimed: '0.00000000',
            lastRewardClaim: null,
            loginStreak: 0,
            prestigeLevel: 0,
            updatedAt: new Date()
        });
        console.log('   ✓ Saldos resetados para $100');
        console.log('   ✓ Estatísticas de gambling zeradas');
        console.log('   ✓ Recompensas e streaks resetados');

        console.log('');
        console.log('✅ Reset da economia concluído com sucesso!\n');
        console.log('📋 Resumo:');
        console.log(`   - ${userCount.count} usuários preservados (conta, username, bio, imagem)`);
        console.log(`   - ${coinCount.count} moedas deletadas`);
        console.log(`   - ${txCount.count} transações deletadas`);
        console.log(`   - ${portfolioCount.count} portfolios deletados`);
        console.log(`   - ${commentCount.count} comentários deletados`);
        console.log(`   - ${predictionCount.count} previsões deletadas`);
        console.log(`   - ${notificationCount.count} notificações deletadas`);
        console.log(`   - Todos os saldos resetados para $100`);
        console.log('');

    } catch (error) {
        console.error('❌ Erro durante o reset:', error);
        process.exit(1);
    } finally {
        await client.end();
        process.exit(0);
    }
}

// Confirmation prompt
const args = process.argv.slice(2);
const forceFlag = args.includes('--force') || args.includes('-f');

if (!forceFlag) {
    console.log('⚠️  ATENÇÃO: Este script irá DELETAR todos os dados econômicos!');
    console.log('');
    console.log('   Serão deletados:');
    console.log('   - Todas as moedas');
    console.log('   - Todas as transações');
    console.log('   - Todos os portfolios');
    console.log('   - Todos os comentários');
    console.log('   - Todas as previsões');
    console.log('   - Todas as notificações');
    console.log('   - Saldos serão resetados para $100');
    console.log('');
    console.log('   Serão PRESERVADOS:');
    console.log('   - Contas de usuário (username, email, bio, imagem)');
    console.log('   - Sessões de login');
    console.log('');
    console.log('Para executar, use: npm run db:reset-economy -- --force');
    console.log('');
    process.exit(0);
}

resetEconomy();
