import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Script } from 'node:vm';

test('runtime ASCII transform preserves production HTML Unicode and valid embedded JS', async () => {
  // Pi's runtime loader can ASCII-escape templates, unlike the tsc dist build.
  const { outputFiles } = await build({entryPoints:['src/voice/lan/web-ui.ts'],bundle:true,platform:'node',format:'esm',charset:'ascii',write:false});
  const source = outputFiles![0]!.text;
  assert.ok(source.includes('\\u5BF9'));
  const { createLanVoiceWebUi } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const html = createLanVoiceWebUi({getFgAnsi:()=> '\x1b[39m',getBgAnsi:()=> '\x1b[49m'});
  const [markup, scriptPart] = html.split('<script>');
  for (const label of ['对话','连接','结束','音频设置','聊天记录','加载更早消息','回到底部','文字消息','输入消息','不加载旧会话']) assert.ok(markup.includes(label), label);
  assert.doesNotMatch(markup, /\\u[0-9a-f]{4}/i);
  const script = scriptPart.split('</script>')[0];
  assert.doesNotThrow(() => new Script(script));
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
});
