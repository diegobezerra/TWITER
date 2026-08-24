// content.js — Interacts with X.com DOM to delete posts, undo retweets, and delete replies
//
// Selectors verified against X.com DOM (2024–2025):
//   article[data-testid="tweet"]          — each tweet card
//   button[data-testid="caret"]           — ⋯ "More" button
//   button[data-testid="unretweet"]       — appears only on YOUR retweets (on your profile)
//   button[data-testid="retweet"]         — retweet button (others' tweets)
//   [role="menu"] / [role="menuitem"]     — dropdown menus
//   button[data-testid="confirmationSheetConfirm"] — confirm dialogs
//
// Reply detection: on profile's "Posts & replies" tab, reply tweets
// contain conversation-context clues.  The script auto-navigates to
// the profile when needed.

(function () {
  'use strict';

  let isRunning = false;
  let shouldStop = false;
  let processedCount = 0;

  // ─── Selectors ──────────────────────────────────────────────────

  const SEL = {
    tweet:            'article[data-testid="tweet"]',
    caret:            '[data-testid="caret"]',
    unretweet:        '[data-testid="unretweet"]',
    menu:             '[role="menu"]',
    menuItem:         '[role="menuitem"]',
    confirmBtn:       '[data-testid="confirmationSheetConfirm"]',
    dialogSheet:      '[data-testid="confirmationSheetDialog"]',
    socialContext:     '[data-testid="socialContext"]',
    primaryColumn:    '[data-testid="primaryColumn"]',
    profileTab:       '[data-testid="AppTabBar_Profile_Link"]',
  };

  // ─── Utility Helpers ────────────────────────────────────────────

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function sendProgress(message, level = 'info') {
    try { chrome.runtime.sendMessage({ type: 'progress', message, level }); } catch (_) {}
  }

  function sendDone(summary) {
    try { chrome.runtime.sendMessage({ type: 'done', summary }); } catch (_) {}
  }

  function randomDelay(base) {
    return base + base * (0.2 + Math.random() * 0.2);
  }

  // ─── DOM Helpers ────────────────────────────────────────────────

  function clickElement(el) {
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.click();
    return true;
  }

  function waitForElement(selector, timeout = 5000) {
    return new Promise(resolve => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);
      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
    });
  }

  function closeOpenMenus() {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', keyCode: 27, which: 27, bubbles: true
    }));
  }

  // ─── Profile / Page Helpers ─────────────────────────────────────

  /**
   * Detect the logged-in user's handle from the nav profile link.
   */
  function getOwnHandle() {
    const profileLink = document.querySelector(SEL.profileTab);
    if (profileLink) {
      const href = profileLink.getAttribute('href') || '';
      // href is like "/username" or "https://x.com/username"
      const match = href.match(/\/@?([A-Za-z0-9_]+)$/);
      if (match) return match[1].toLowerCase();
    }
    // Fallback: look for the SideNav account info
    const accountBtn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (accountBtn) {
      const text = accountBtn.textContent || '';
      const match = text.match(/@([A-Za-z0-9_]+)/);
      if (match) return match[1].toLowerCase();
    }
    return null;
  }

  /**
   * Check if we're on the user's own profile page (not home, not someone else's).
   */
  function isOnOwnProfile() {
    const path = window.location.pathname.toLowerCase();
    const handle = getOwnHandle();
    if (!handle) return false;
    // Path should be "/handle" or "/handle/with_replies" etc.
    return path.startsWith('/' + handle);
  }

  /**
   * Check if we're on the "Posts & replies" tab of the profile.
   */
  function isOnRepliesTab() {
    return window.location.pathname.toLowerCase().includes('/with_replies');
  }

  /**
   * Navigate to own profile's "Posts & replies" tab.
   * Returns true if navigation happened, false if already there or failed.
   */
  async function navigateToProfileReplies() {
    if (isOnOwnProfile() && isOnRepliesTab()) {
      sendProgress('Já estamos na aba "Respostas" do perfil ✅');
      return true;
    }

    const handle = getOwnHandle();
    if (!handle) {
      sendProgress('Não foi possível detectar seu usuário. Navegue ao seu perfil manualmente.', 'error');
      return false;
    }

    const targetUrl = `https://x.com/${handle}/with_replies`;
    sendProgress(`Navegando para ${targetUrl}…`);
    window.location.href = targetUrl;

    // Wait for page to load
    await sleep(3000);
    await waitForElement(SEL.tweet, 8000);
    return true;
  }

  /**
   * Navigate to own profile (main posts tab).
   */
  async function navigateToOwnProfile() {
    if (isOnOwnProfile()) {
      sendProgress('Já estamos no seu perfil ✅');
      return true;
    }

    const handle = getOwnHandle();
    if (!handle) {
      sendProgress('Não foi possível detectar seu usuário.', 'error');
      return false;
    }

    const targetUrl = `https://x.com/${handle}`;
    sendProgress(`Navegando para ${targetUrl}…`);
    window.location.href = targetUrl;

    await sleep(3000);
    await waitForElement(SEL.tweet, 8000);
    return true;
  }

  // ─── Tweet Classification ───────────────────────────────────────

  function getTweetArticles() {
    return Array.from(document.querySelectorAll(SEL.tweet));
  }

  /**
   * Detect a retweet.
   * Primary: [data-testid="unretweet"] button (only on your own retweets).
   * Secondary: socialContext with "Repost" / "Repostou" text.
   */
  function isRetweet(article) {
    if (article.querySelector(SEL.unretweet)) return true;
    const ctx = article.querySelector(SEL.socialContext);
    if (ctx) {
      const t = ctx.textContent.toLowerCase();
      if (t.includes('repost') || t.includes('retweet') || t.includes('repostou')) return true;
    }
    return false;
  }

  function isOwnTweet(article) {
    return !isRetweet(article);
  }

  /**
   * Check if a tweet was authored by the logged-in user.
   * Strategy: look for UserAvatar-Container-{handle} data-testid inside
   * the tweet, and compare with our own handle.
   */
  function isOwnAuthor(article) {
    const handle = getOwnHandle();
    if (!handle) return false;

    // Check avatar containers: data-testid="UserAvatar-Container-{handle}"
    const avatarContainers = article.querySelectorAll('[data-testid]');
    for (const el of avatarContainers) {
      const testid = el.getAttribute('data-testid') || '';
      if (testid.toLowerCase().includes('useravatar-container-' + handle.toLowerCase())) {
        return true;
      }
    }

    // Fallback: check if the @handle text appears in the tweet's user name area
    const nameEl = article.querySelector('[data-testid="User-Name"]');
    if (nameEl) {
      const nameText = nameEl.textContent.toLowerCase();
      if (nameText.includes('@' + handle.toLowerCase())) return true;
    }

    return false;
  }

  /**
   * Detect a reply using multiple strategies:
   * 1. socialContext with "Replying to" / "Respondendo"
   * 2. Text containing "replying to" in spans
   * 3. "show this thread" links
   * 4. On /with_replies tab: any tweet that is ours (the tab mixes posts + replies)
   */
  function isReply(article) {
    // Strategy 1: socialContext
    const ctx = article.querySelector(SEL.socialContext);
    if (ctx) {
      const t = ctx.textContent.toLowerCase();
      if (t.includes('reply') || t.includes('respond')) return true;
    }

    // Strategy 2: Look for "Replying to" / "Respondendo" text
    const allEls = article.querySelectorAll('span, a, div');
    for (const el of allEls) {
      const t = (el.textContent || '').toLowerCase();
      if (t.includes('replying to') || t.includes('respondendo a') ||
          t.includes('respondeu a') || t.includes('replied to')) {
        return true;
      }
    }

    // Strategy 3: "show this thread" links
    for (const link of article.querySelectorAll('a')) {
      const t = (link.textContent || '').toLowerCase();
      if (t.includes('show this thread') || t.includes('mostrar esta thread') ||
          t.includes('ver esta conversa')) return true;
    }

    // Strategy 4: On /with_replies tab, if the tweet is by the logged-in user,
    // treat it as a reply (the tab shows all user content including replies)
    if (isOnRepliesTab() && isOwnAuthor(article)) return true;

    return false;
  }

  // ─── Menu Interaction ───────────────────────────────────────────

  async function clickMenuItemByPatterns(textPatterns, timeout = 4000) {
    const menu = await waitForElement(SEL.menu, timeout);
    if (!menu) {
      sendProgress('Menu não encontrado', 'error');
      return false;
    }

    await sleep(250);
    const items = menu.querySelectorAll(SEL.menuItem);

    for (const item of items) {
      const text = (item.textContent || '').trim().toLowerCase();
      for (const pattern of textPatterns) {
        if (text.includes(pattern.toLowerCase())) {
          clickElement(item);
          await sleep(300);
          return true;
        }
      }
    }

    // Fallback: scan all spans in menu
    for (const span of menu.querySelectorAll('span')) {
      const t = (span.textContent || '').trim().toLowerCase();
      for (const pattern of textPatterns) {
        if (t === pattern.toLowerCase()) {
          const clickable = span.closest('[role="menuitem"]') || span.closest('div[class]') || span;
          clickElement(clickable);
          await sleep(300);
          return true;
        }
      }
    }

    return false;
  }

  async function confirmDialog(timeout = 3000) {
    const btn = await waitForElement(SEL.confirmBtn, timeout);
    if (btn) { clickElement(btn); await sleep(500); return true; }

    const dialog = document.querySelector(SEL.dialogSheet);
    if (dialog) {
      for (const b of dialog.querySelectorAll('button, [role="button"]')) {
        const t = (b.textContent || '').toLowerCase();
        if (['apagar', 'delete', 'excluir', 'confirmar', 'sim', 'yes'].some(p => t.includes(p))) {
          clickElement(b); await sleep(500); return true;
        }
      }
    }
    return false;
  }

  // ─── Delete a Single Tweet ──────────────────────────────────────

  async function deleteSingleTweet(article) {
    const caret = article.querySelector(SEL.caret);
    if (!caret) { sendProgress('Botão ⋯ não encontrado', 'error'); return false; }

    clickElement(caret);
    await sleep(500);

    const clicked = await clickMenuItemByPatterns(['delete', 'apagar', 'excluir']);
    if (!clicked) {
      closeOpenMenus(); await sleep(300);
      sendProgress('Opção "Delete/Apagar" não encontrada no menu', 'error');
      return false;
    }

    await sleep(300);
    const confirmed = await confirmDialog();
    if (!confirmed) {
      sendProgress('Diálogo de confirmação não encontrado', 'error');
      return false;
    }
    return true;
  }

  // ─── Undo a Single Retweet ──────────────────────────────────────

  async function undoSingleRetweet(article) {
    const urBtn = article.querySelector(SEL.unretweet);
    if (!urBtn) { sendProgress('Botão de retweet não encontrado', 'error'); return false; }

    clickElement(urBtn);
    await sleep(500);

    const undoClicked = await clickMenuItemByPatterns([
      'undo repost', 'undo retweet', 'desfazer retweet',
      'desfazer repost', 'undo', 'desfazer'
    ], 3000);

    if (undoClicked) return true;

    const confirmed = await confirmDialog(2000);
    if (confirmed) return true;

    sendProgress('Opção de desfazer retweet não encontrada', 'error');
    return false;
  }

  // ─── Scroll ─────────────────────────────────────────────────────

  async function scrollToLoadMore() {
    window.scrollBy(0, 600);
    await sleep(1200);
  }

  // ─── Main: Delete Posts ─────────────────────────────────────────

  async function deletePosts(config) {
    const { delay = 3000, maxItems = 10 } = config;
    processedCount = 0;

    // Ensure we're on own profile
    if (!isOnOwnProfile()) {
      sendProgress('⚠️ Navegando para seu perfil…');
      await navigateToOwnProfile();
    }

    sendProgress(`Iniciando exclusão de posts (máx: ${maxItems})`);

    while (isRunning && processedCount < maxItems && !shouldStop) {
      const ownTweets = getTweetArticles().filter(isOwnTweet);

      if (ownTweets.length === 0) {
        sendProgress('Nenhum post próprio encontrado, carregando mais…');
        await scrollToLoadMore();
        await sleep(1000);
        if (getTweetArticles().filter(isOwnTweet).length === 0) {
          sendProgress('Fim — nenhum post adicional encontrado.', 'warning');
          break;
        }
        continue;
      }

      sendProgress(`Apagando post ${processedCount + 1}/${maxItems}…`);
      try {
        if (await deleteSingleTweet(ownTweets[0])) {
          processedCount++;
          sendProgress(`✅ Post ${processedCount} apagado`, 'success');
        } else { closeOpenMenus(); await sleep(500); }
      } catch (err) {
        sendProgress(`Erro: ${err.message}`, 'error');
        closeOpenMenus(); await sleep(500);
      }

      if (isRunning && processedCount < maxItems && !shouldStop) {
        await sleep(randomDelay(delay));
      }
    }

    sendDone(`${processedCount} post(s) apagado(s)`);
  }

  // ─── Main: Undo Retweets ────────────────────────────────────────

  async function undoRetweets(config) {
    const { delay = 3000, maxItems = 10 } = config;
    processedCount = 0;

    // Navigate to own profile where unretweet buttons appear
    if (!isOnOwnProfile()) {
      sendProgress('⚠️ Navegando para seu perfil (retweets só aparecem no seu perfil)…');
      await navigateToOwnProfile();
    }

    sendProgress(`Iniciando desfazer retweets (máx: ${maxItems})`);

    while (isRunning && processedCount < maxItems && !shouldStop) {
      const rts = getTweetArticles().filter(isRetweet);

      if (rts.length === 0) {
        sendProgress('Nenhum retweet seu encontrado, carregando mais…');
        await scrollToLoadMore();
        await sleep(1000);
        if (getTweetArticles().filter(isRetweet).length === 0) {
          sendProgress('Fim — nenhum retweet adicional encontrado.', 'warning');
          break;
        }
        continue;
      }

      sendProgress(`Desfazendo retweet ${processedCount + 1}/${maxItems}…`);
      try {
        if (await undoSingleRetweet(rts[0])) {
          processedCount++;
          sendProgress(`✅ Retweet ${processedCount} desfeito`, 'success');
        } else { closeOpenMenus(); await sleep(500); }
      } catch (err) {
        sendProgress(`Erro: ${err.message}`, 'error');
        closeOpenMenus(); await sleep(500);
      }

      if (isRunning && processedCount < maxItems && !shouldStop) {
        await sleep(randomDelay(delay));
      }
    }

    sendDone(`${processedCount} retweet(s) desfeito(s)`);
  }

  // ─── Main: Delete Replies ───────────────────────────────────────

  async function deleteReplies(config) {
    const { delay = 3000, maxItems = 10 } = config;
    processedCount = 0;

    // Navigate to profile's "Posts & replies" tab
    sendProgress('⚠️ Navegando para aba "Respostas" do seu perfil…');
    await navigateToProfileReplies();

    sendProgress(`Iniciando exclusão de respostas (máx: ${maxItems})`);

    // Log author detection for debugging
    const allTweets = getTweetArticles();
    const ownCount = allTweets.filter(isOwnAuthor).length;
    sendProgress(`Encontrados ${allTweets.length} tweets, ${ownCount} são seus`);

    while (isRunning && processedCount < maxItems && !shouldStop) {
      const replies = getTweetArticles().filter(isReply);

      if (replies.length === 0) {
        sendProgress('Nenhuma resposta encontrada, carregando mais…');
        await scrollToLoadMore();
        await sleep(1500);
        if (getTweetArticles().filter(isReply).length === 0) {
          sendProgress('Fim — nenhuma resposta adicional encontrada.', 'warning');
          break;
        }
        continue;
      }

      sendProgress(`Apagando resposta ${processedCount + 1}/${maxItems}…`);
      try {
        if (await deleteSingleTweet(replies[0])) {
          processedCount++;
          sendProgress(`✅ Resposta ${processedCount} apagada`, 'success');
        } else { closeOpenMenus(); await sleep(500); }
      } catch (err) {
        sendProgress(`Erro: ${err.message}`, 'error');
        closeOpenMenus(); await sleep(500);
      }

      if (isRunning && processedCount < maxItems && !shouldStop) {
        await sleep(randomDelay(delay));
      }
    }

    sendDone(`${processedCount} resposta(s) apagada(s)`);
  }

  // ─── Main: Delete All ───────────────────────────────────────────

  async function deleteAll(config) {
    const { delay = 3000, maxPosts = 10, maxRts = 10, maxReplies = 10 } = config;
    processedCount = 0;

    sendProgress('🔥 Iniciando limpeza total…');
    isRunning = true;
    shouldStop = false;

    // Phase 1 — delete own posts
    sendProgress('── Fase 1: Apagando posts ──');
    if (!isOnOwnProfile()) await navigateToOwnProfile();

    while (isRunning && processedCount < maxPosts && !shouldStop) {
      const ownTweets = getTweetArticles().filter(t => isOwnTweet(t) && !isReply(t));
      if (ownTweets.length === 0) {
        await scrollToLoadMore(); await sleep(1000);
        if (getTweetArticles().filter(t => isOwnTweet(t) && !isReply(t)).length === 0) break;
        continue;
      }
      try {
        if (await deleteSingleTweet(ownTweets[0])) { processedCount++; sendProgress(`✅ Post ${processedCount} apagado`, 'success'); }
        else { closeOpenMenus(); await sleep(500); }
      } catch (_) { closeOpenMenus(); await sleep(500); }
      if (isRunning && processedCount < maxPosts && !shouldStop) await sleep(randomDelay(delay));
    }
    const postsDeleted = processedCount;

    // Phase 2 — undo retweets
    sendProgress('── Fase 2: Desfazendo retweets ──');
    processedCount = 0;

    while (isRunning && processedCount < maxRts && !shouldStop) {
      const rts = getTweetArticles().filter(isRetweet);
      if (rts.length === 0) {
        await scrollToLoadMore(); await sleep(1000);
        if (getTweetArticles().filter(isRetweet).length === 0) break;
        continue;
      }
      try {
        if (await undoSingleRetweet(rts[0])) { processedCount++; sendProgress(`✅ RT ${processedCount} desfeito`, 'success'); }
        else { closeOpenMenus(); await sleep(500); }
      } catch (_) { closeOpenMenus(); await sleep(500); }
      if (isRunning && processedCount < maxRts && !shouldStop) await sleep(randomDelay(delay));
    }
    const rtsUndone = processedCount;

    // Phase 3 — delete replies
    sendProgress('── Fase 3: Apagando respostas ──');
    processedCount = 0;
    await navigateToProfileReplies();

    while (isRunning && processedCount < maxReplies && !shouldStop) {
      const replies = getTweetArticles().filter(isReply);
      if (replies.length === 0) {
        await scrollToLoadMore(); await sleep(1500);
        if (getTweetArticles().filter(isReply).length === 0) break;
        continue;
      }
      try {
        if (await deleteSingleTweet(replies[0])) { processedCount++; sendProgress(`✅ Resposta ${processedCount} apagada`, 'success'); }
        else { closeOpenMenus(); await sleep(500); }
      } catch (_) { closeOpenMenus(); await sleep(500); }
      if (isRunning && processedCount < maxReplies && !shouldStop) await sleep(randomDelay(delay));
    }

    sendDone(`Limpeza: ${postsDeleted} posts, ${rtsUndone} RTs, ${processedCount} respostas`);
  }

  // ─── Debug Inspector ───────────────────────────────────────────

  function debugInspect() {
    const tweets = getTweetArticles();
    sendProgress(`🔍 DEBUG: ${tweets.length} tweet(s) encontrados`, 'warning');
    sendProgress(`📍 URL: ${window.location.href}`, 'warning');
    sendProgress(`👤 Handle detectado: ${getOwnHandle() || 'N/A'}`, 'warning');
    sendProgress(`🏠 No seu perfil: ${isOnOwnProfile() ? 'SIM' : 'NÃO'}`, isOnOwnProfile() ? 'success' : 'error');
    sendProgress(`💬 Aba de respostas: ${isOnRepliesTab() ? 'SIM' : 'NÃO'}`, isOnRepliesTab() ? 'success' : 'warning');

    if (tweets.length === 0) {
      sendProgress('Nenhum article[data-testid="tweet"] encontrado!', 'error');
      const allTestIds = document.querySelectorAll('[data-testid]');
      const ids = new Set();
      allTestIds.forEach(el => ids.add(el.getAttribute('data-testid')));
      sendProgress(`data-testid na página: ${[...ids].sort().join(', ')}`, 'warning');
      return;
    }

    tweets.forEach((tweet, i) => {
      if (i >= 5) return;

      const testIds = tweet.querySelectorAll('[data-testid]');
      const ids = [];
      testIds.forEach(el => ids.push(el.getAttribute('data-testid')));
      sendProgress(`Tweet ${i + 1} testids: [${[...new Set(ids)].join(', ')}]`, 'warning');

      const urBtn = tweet.querySelector('[data-testid="unretweet"]');
      const rtBtn = tweet.querySelector('[data-testid="retweet"]');
      const socialCtx = tweet.querySelector('[data-testid="socialContext"]');
      const caret = tweet.querySelector('[data-testid="caret"]');

      sendProgress(`  unretweet: ${urBtn ? '✅' : '❌'}  retweet: ${rtBtn ? '✅' : '❌'}  socialCtx: ${socialCtx ? '✅ "' + socialCtx.textContent.trim().substring(0, 40) + '"' : '❌'}  caret: ${caret ? '✅' : '❌'}`,
        (urBtn || socialCtx) ? 'success' : 'info');

      // Check for reply indicators
      const hasReplyText = tweet.textContent.toLowerCase().includes('replying to') ||
                           tweet.textContent.toLowerCase().includes('respondendo');
      const hasThreadLink = Array.from(tweet.querySelectorAll('a')).some(a => {
        const t = (a.textContent || '').toLowerCase();
        return t.includes('show this thread') || t.includes('mostrar esta thread') || t.includes('ver esta conversa');
      });
      const ownAuthor = isOwnAuthor(tweet);
      sendProgress(`  own author: ${ownAuthor ? '✅ YES (SEU)' : '❌ NO'}  reply indicators: text=${hasReplyText ? '✅' : '❌'}  threadLink=${hasThreadLink ? '✅' : '❌'}`, ownAuthor ? 'success' : 'info');

      const tweetText = tweet.textContent.substring(0, 120).replace(/\s+/g, ' ').trim();
      sendProgress(`  text: "${tweetText}…"`, 'info');
    });

    const allTestIds = document.querySelectorAll('[data-testid]');
    const idSet = new Set();
    allTestIds.forEach(el => idSet.add(el.getAttribute('data-testid')));
    sendProgress(`Todos data-testid (${idSet.size}): ${[...idSet].sort().join(', ')}`, 'warning');
  }

  // ─── Message Listener ───────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'stop') {
      shouldStop = true; isRunning = false;
      sendProgress('⏹️ Parando…', 'warning');
      sendResponse({ message: 'Parado' });
      return true;
    }
    if (msg.action === 'debug') {
      debugInspect();
      sendResponse({ message: 'Debug concluído' });
      return true;
    }
    if (msg.action === 'start-delete-posts') {
      isRunning = true; shouldStop = false;
      deletePosts(msg);
      sendResponse({ message: 'Iniciado' });
      return true;
    }
    if (msg.action === 'start-delete-rts') {
      isRunning = true; shouldStop = false;
      undoRetweets(msg);
      sendResponse({ message: 'Iniciado' });
      return true;
    }
    if (msg.action === 'start-delete-replies') {
      isRunning = true; shouldStop = false;
      deleteReplies(msg);
      sendResponse({ message: 'Iniciado' });
      return true;
    }
    if (msg.action === 'start-delete-all') {
      isRunning = true; shouldStop = false;
      deleteAll(msg);
      sendResponse({ message: 'Iniciado' });
      return true;
    }
  });

  console.log('[X Post Cleaner] Content script loaded ✅');
})();
