// popup.js — UI logic for the extension popup

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const statusBar = document.getElementById('status-bar');
  const statusText = document.getElementById('status-text');
  const logBox = document.getElementById('log');

  const postDelay = document.getElementById('post-delay');
  const postDelayValue = document.getElementById('post-delay-value');
  const postMax = document.getElementById('post-max');
  const postMaxValue = document.getElementById('post-max-value');

  const rtDelay = document.getElementById('rt-delay');
  const rtDelayValue = document.getElementById('rt-delay-value');
  const rtMax = document.getElementById('rt-max');
  const rtMaxValue = document.getElementById('rt-max-value');

  const btnDeletePosts = document.getElementById('btn-delete-posts');
  const btnStopPosts = document.getElementById('btn-stop-posts');
  const btnDeleteRts = document.getElementById('btn-delete-rts');
  const btnStopRts = document.getElementById('btn-stop-rts');
  const btnDeleteAll = document.getElementById('btn-delete-all');
  const btnStopAll = document.getElementById('btn-stop-all');
  const btnDebug = document.getElementById('btn-debug');

  const replyDelay = document.getElementById('reply-delay');
  const replyDelayValue = document.getElementById('reply-delay-value');
  const replyMax = document.getElementById('reply-max');
  const replyMaxValue = document.getElementById('reply-max-value');
  const btnDeleteReplies = document.getElementById('btn-delete-replies');
  const btnStopReplies = document.getElementById('btn-stop-replies');

  // --- Slider updates ---
  function setupSlider(slider, display, formatter) {
    slider.addEventListener('input', () => {
      display.textContent = formatter(slider.value);
    });
  }

  setupSlider(postDelay, postDelayValue, v => (v / 1000).toFixed(1) + 's');
  setupSlider(postMax, postMaxValue, v => v);
  setupSlider(rtDelay, rtDelayValue, v => (v / 1000).toFixed(1) + 's');
  setupSlider(rtMax, rtMaxValue, v => v);
  setupSlider(replyDelay, replyDelayValue, v => (v / 1000).toFixed(1) + 's');
  setupSlider(replyMax, replyMaxValue, v => v);

  // --- Logging ---
  function addLog(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.textContent = `[${time}] ${message}`;
    logBox.appendChild(entry);
    logBox.scrollTop = logBox.scrollHeight;
  }

  // --- Status ---
  function setStatus(text, mode = '') {
    statusBar.classList.remove('hidden', 'running', 'error');
    if (mode) statusBar.classList.add(mode);
    statusText.textContent = text;
  }

  function clearStatus() {
    statusBar.classList.add('hidden');
  }

  // --- Communication with content script ---
  function sendToContent(message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
          reject(new Error('No active tab'));
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      });
    });
  }

  // --- Button handlers ---
  btnDeletePosts.addEventListener('click', async () => {
    const config = {
      action: 'start-delete-posts',
      delay: parseInt(postDelay.value),
      maxItems: parseInt(postMax.value)
    };
    addLog(`Iniciando exclusão de posts (max: ${config.maxItems}, delay: ${config.delay}ms)`, 'warning');
    setStatus('🔴 Apagando posts...', 'running');
    showStopButtons('posts');

    try {
      const response = await sendToContent(config);
      addLog(`Resultado: ${response?.message || 'Enviado'}`, 'success');
    } catch (err) {
      addLog(`Erro: ${err.message}`, 'error');
      clearStatus();
      hideStopButtons();
    }
  });

  btnDeleteRts.addEventListener('click', async () => {
    const config = {
      action: 'start-delete-rts',
      delay: parseInt(rtDelay.value),
      maxItems: parseInt(rtMax.value)
    };
    addLog(`Iniciando desfazer retweets (max: ${config.maxItems}, delay: ${config.delay}ms)`, 'warning');
    setStatus('🔄 Desfazendo retweets...', 'running');
    showStopButtons('rts');

    try {
      const response = await sendToContent(config);
      addLog(`Resultado: ${response?.message || 'Enviado'}`, 'success');
    } catch (err) {
      addLog(`Erro: ${err.message}`, 'error');
      clearStatus();
      hideStopButtons();
    }
  });

  btnDeleteReplies.addEventListener('click', async () => {
    const config = {
      action: 'start-delete-replies',
      delay: parseInt(replyDelay.value),
      maxItems: parseInt(replyMax.value)
    };
    addLog(`Iniciando exclusão de respostas (max: ${config.maxItems}, delay: ${config.delay}ms)`, 'warning');
    setStatus('💬 Apagando respostas...', 'running');
    showStopButtons('replies');

    try {
      const response = await sendToContent(config);
      addLog(`Resultado: ${response?.message || 'Enviado'}`, 'success');
    } catch (err) {
      addLog(`Erro: ${err.message}`, 'error');
      clearStatus();
      hideStopButtons();
    }
  });

  btnDeleteAll.addEventListener('click', async () => {
    const config = {
      action: 'start-delete-all',
      delay: parseInt(postDelay.value),
      maxPosts: parseInt(postMax.value),
      maxRts: parseInt(rtMax.value),
      maxReplies: parseInt(replyMax.value)
    };
    addLog(`Iniciando limpeza total (posts: ${config.maxPosts}, rts: ${config.maxRts}, replies: ${config.maxReplies})`, 'warning');
    setStatus('🔥 Limpando tudo...', 'running');
    showStopButtons('all');

    try {
      const response = await sendToContent(config);
      addLog(`Resultado: ${response?.message || 'Enviado'}`, 'success');
    } catch (err) {
      addLog(`Erro: ${err.message}`, 'error');
      clearStatus();
      hideStopButtons();
    }
  });

  // Stop buttons
  [btnStopPosts, btnStopRts, btnStopReplies, btnStopAll].forEach(btn => {
    btn.addEventListener('click', async () => {
      addLog('⏹️ Parando...', 'warning');
      try {
        await sendToContent({ action: 'stop' });
        addLog('Parado com sucesso', 'info');
        clearStatus();
        hideStopButtons();
      } catch (err) {
        addLog(`Erro ao parar: ${err.message}`, 'error');
      }
    });
  });

  // --- Show/Hide stop buttons ---
  function showStopButtons(mode) {
    btnDeletePosts.classList.add('hidden');
    btnDeleteRts.classList.add('hidden');
    btnDeleteReplies.classList.add('hidden');
    btnDeleteAll.classList.add('hidden');

    if (mode === 'posts') btnStopPosts.classList.remove('hidden');
    else if (mode === 'rts') btnStopRts.classList.remove('hidden');
    else if (mode === 'replies') btnStopReplies.classList.remove('hidden');
    else if (mode === 'all') btnStopAll.classList.remove('hidden');
  }

  function hideStopButtons() {
    btnStopPosts.classList.add('hidden');
    btnStopRts.classList.add('hidden');
    btnStopReplies.classList.add('hidden');
    btnStopAll.classList.add('hidden');
    btnDeletePosts.classList.remove('hidden');
    btnDeleteRts.classList.remove('hidden');
    btnDeleteReplies.classList.remove('hidden');
    btnDeleteAll.classList.remove('hidden');
  }

  // --- Listen for status updates from content script ---
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'progress') {
      addLog(msg.message, msg.level || 'info');
    }
    if (msg.type === 'done') {
      addLog(`✅ Concluído! ${msg.summary || ''}`, 'success');
      clearStatus();
      hideStopButtons();
    }
    if (msg.type === 'error') {
      addLog(`❌ ${msg.message}`, 'error');
      clearStatus();
      hideStopButtons();
    }
  });

  // Debug button
  btnDebug.addEventListener('click', async () => {
    addLog('🔍 Inspecionando DOM do X.com...', 'warning');
    try {
      await sendToContent({ action: 'debug' });
    } catch (err) {
      addLog(`Erro: ${err.message}`, 'error');
    }
  });

  // --- Check if we're on X.com ---
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url || '';
    if (!url.includes('x.com') && !url.includes('twitter.com')) {
      addLog('⚠️ Abra o X.com para usar esta extensão', 'warning');
      setStatus('⚠️ Abra o X.com primeiro', 'error');
      document.querySelectorAll('.btn').forEach(b => b.disabled = true);
    }
  });
});
