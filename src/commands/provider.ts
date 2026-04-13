import fs from 'fs/promises';
import { getProviderManager } from '../core/provider-manager.js';
import { applyProviderConfig } from '../core/error-handler.js';

interface ProviderCommandOptions {
  list?: boolean;
  add?: boolean;
  switch?: string;
  remove?: string;
  name?: string;
  token?: string;
  url?: string;
  model?: string;
}

export async function providerCommand(options: ProviderCommandOptions): Promise<void> {
  const manager = getProviderManager();
  await manager.initialize();

  if (options.list) {
    // 列出所有提供商
    manager.printStatus();
    return;
  }

  if (options.add) {
    // 添加新提供商
    if (!options.name || !options.token || !options.url || !options.model) {
      console.error('❌ 添加提供商需要以下参数：');
      console.error('   --name <名称>');
      console.error('   --token <认证token>');
      console.error('   --url <API地址>');
      console.error('   --model <模型名称>');
      console.error('\n示例:');
      console.error('   provider --add --name glm-1 --token "xxx" --url "https://open.bigmodel.cn/api/anthropic" --model "GLM-4.7"');
      process.exit(1);
    }

    await manager.addProvider({
      name: options.name,
      authToken: options.token,
      baseUrl: options.url,
      model: options.model,
    });

    console.log(`✅ 已添加提供商: ${options.name}`);
    console.log(`   配置文件: ${manager.getConfigDir()}/${options.name}.json`);
    manager.printStatus();
    return;
  }

  if (options.remove) {
    // 删除提供商
    try {
      await manager.removeProvider(options.remove);
      console.log(`✅ 已删除提供商: ${options.remove}`);
    } catch (error) {
      console.error(`❌ ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
    manager.printStatus();
    return;
  }

  if (options.switch) {
    // 切换提供商
    const result = await manager.switchTo(options.switch);

    if (!result.success) {
      console.error(`❌ ${result.reason}`);
      if (result.instructions) {
        console.error(result.instructions);
      }
      process.exit(1);
    }

    console.log(`✅ 已切换到提供商: ${result.newProvider}`);
    manager.printStatus();

    // 显示环境变量设置命令
    const env = manager.getEnvConfig();
    if (env) {
      console.log('\n当前环境变量配置:');
      console.log(`export ANTHROPIC_AUTH_TOKEN="${env.ANTHROPIC_AUTH_TOKEN}"`);
      console.log(`export ANTHROPIC_BASE_URL="${env.ANTHROPIC_BASE_URL}"`);
      console.log(`export ANTHROPIC_MODEL="${env.ANTHROPIC_MODEL}"`);
    }
    return;
  }

  // 默认：显示状态
  manager.printStatus();

  // 提示配置目录
  console.log(`\n💡 配置目录: ${manager.getConfigDir()}`);
  console.log('   每个提供商一个 JSON 文件，例如: glm-1.json');
}
