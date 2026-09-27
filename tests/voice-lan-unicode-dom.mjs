// Run in the isolated harness with CDP Runtime.evaluate; never use a live tab.
export function verifyUnicodeDom() {
  const assert = (ok, label) => { if (!ok) throw Error(label); };
  assert(document.querySelector('strong').textContent === '对话', 'header');
  assert(document.querySelector('#draft').placeholder === '输入消息', 'placeholder');
  const emit = command => window.__events[0].onmessage({data:JSON.stringify(command)});
  emit({type:'transcript.epoch',epoch:'unicode-test'});
  const text = '中文 字面\\u4F60 <img src=x onerror="window.__xss=true"> </script><script>window.__xss=true</script>';
  emit({type:'transcript.message',epoch:'unicode-test',message:{messageId:'test',seq:1,revision:1,role:'user',source:'text',status:'streaming',text}});
  assert(document.querySelector('#messages p').textContent === text, 'literal Unicode escape / XSS text preserved');
  assert(document.querySelector('#messages small').textContent === '正在回复…', 'script Unicode label');
  assert(!document.querySelector('#messages img, #messages script') && !window.__xss, 'XSS');
  emit({type:'error',message:'测试错误 字面\\u4F60'});
  assert(document.querySelector('#audio-detail').textContent === '测试错误 字面\\u4F60', 'error preserved');
  document.querySelector('details').open = true;
  return {header:document.querySelector('strong').textContent,placeholder:document.querySelector('#draft').placeholder,message:document.querySelector('#messages p').textContent,status:document.querySelector('#messages small').textContent,xss:false};
}
