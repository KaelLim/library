import 'dotenv/config';
import { runImportWorker } from './worker.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
使用方式:
  npm run import <md檔案路徑> [期數] [使用者email]

範例:
  npm run import ./downloads/慈濟週報第117期.md
  npm run import ./downloads/週報.md 117
  npm run import ./downloads/週報.md 117 editor@example.com
`);
    process.exit(1);
  }

  const filePath = args[0];
  const weeklyId = args[1] ? parseInt(args[1], 10) : undefined;
  const userEmail = args[2];

  console.log('========================================');
  console.log('週報匯入工作流程');
  console.log('========================================');
  console.log(`檔案: ${filePath}`);
  if (weeklyId) console.log(`期數: ${weeklyId}`);
  if (userEmail) console.log(`使用者: ${userEmail}`);
  console.log('========================================\n');

  try {
    await runImportWorker(
      { filePath, weeklyId, userEmail },
      (step, progress, error) => {
        if (error) {
          console.error(`❌ [${step}] ${error}`);
        } else {
          console.log(`✓ [${step}] ${progress || ''}`);
        }
      }
    );

    console.log('\n========================================');
    console.log('匯入完成！');
    console.log('========================================');
  } catch (error) {
    console.error('\n========================================');
    console.error('匯入失敗！');
    console.error('========================================');
    process.exit(1);
  }
}

main();
