import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createApplication } from '../dist/server/index.mjs';
import { createNodeServer } from '../lib/http.mjs';

// Mirrors the client's example list: English local Sample S11 uses the fixed blue-hat reference; otherwise the showcase presets.
const shownPresets = (scenario, englishSample) => englishSample && scenario.id === 'S11'
  ? scenario.queries.filter(Boolean).slice(0, 4).map(query => ({ label: `${query} (fixed blue-hat Sample)`, query }))
  : scenario.demoPresets;
// Document language lives in the header settings panel.
async function chooseLanguage(page, language) {
  await page.locator('#profile-button').click();
  await page.locator('#menu-settings').click();
  await page.locator(`input[name="document-language"][value="${language}"]`).check();
  await page.keyboard.press('Escape');
}

test('studio desktop/mobile comparisons, keyboard, reset and late response isolation', { timeout: 180000 }, async () => {
  const app = createApplication({ fetchUpstream: () => assert.fail('Browser sample tests must not call Azure'), log: () => {} });
  const serverEnv = { PUBLIC_ORIGIN: 'http://localhost:3000', FOUNDRY_IQ_LIVE_ENABLED: 'false' };
  const server = createNodeServer(app, serverEnv);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  serverEnv.PUBLIC_ORIGIN = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  const errors = [];
  let runs = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/demo/run') runs++; });
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(serverEnv.PUBLIC_ORIGIN);
    await page.waitForFunction(() => document.querySelector('#scenario').options.length === 11);
    assert.equal(await page.locator('#count').inputValue(), '10');
    assert.equal(await page.locator('header.topbar').count(), 1);
    assert.equal(await page.locator('aside').count(), 0);
    assert.equal(await page.locator('#mode option[value=live]').textContent(), 'Live data');
    const selector = page.locator('#scenario-selector');
    await page.locator('#scenario').click();
    assert.equal(await selector.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.waitForFunction(() => document.querySelector('#scenario').matches(':open'));
    await page.waitForTimeout(180);
    const expandedArrow = await selector.evaluate(el => getComputedStyle(el, '::after').transform);
    await page.mouse.click(30, 30);
    await page.waitForFunction(() => !document.querySelector('#scenario').matches(':open'));
    await page.waitForTimeout(180);
    assert.notEqual(await selector.evaluate(el => getComputedStyle(el, '::after').transform), expandedArrow);
    await page.locator('#scenario').evaluate(el => { el.blur(); el.focus(); });
    assert.equal(await selector.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await selector.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    await page.locator('#scenario').evaluate(el => { el.blur(); el.focus(); });
    assert.equal(await selector.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForFunction(() => document.querySelector('#scenario').matches(':open'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#scenario').matches(':open'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await selector.evaluate(el => getComputedStyle(el, '::after').transitionDuration), '0s');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const catalog = await (await page.request.get(serverEnv.PUBLIC_ORIGIN + '/api/scenarios')).json();
    for (let i = 1; i <= 11; i++) {
      const id = `S${String(i).padStart(2, '0')}`;
      await page.selectOption('#scenario', id);
      const before = runs;
      await page.locator('#query').click();
      assert.equal(await page.locator('#query').getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('#query-suggestions [role=option]').count(), 4);
      const scenario = catalog.scenarios.find(item => item.id === id);
      const labels = await page.locator('#query-suggestions [role=option]').allTextContents();
      const shown = shownPresets(scenario, true);
      assert.deepEqual(labels.map(label => label.trim()), shown.map(preset => preset.label));
      const anchor = await page.locator('.query').evaluate(el => {
        // The list is anchored to the whole search box (leading icon included).
        const input = el.querySelector('.search-box').getBoundingClientRect();
        const list = el.querySelector('[role=listbox]').getBoundingClientRect();
        return { input, list };
      });
      assert.equal(anchor.input.x, anchor.list.x);
      assert.equal(anchor.input.width, anchor.list.width);
      assert.ok(anchor.list.y >= anchor.input.bottom);
      await page.locator('#query').press('ArrowDown');
      assert.ok(await page.locator('#query').getAttribute('aria-activedescendant'));
      await page.locator('#query').press('Enter');
      assert.equal(await page.locator('#query-suggestions').isVisible(), false);
      assert.equal(await page.locator('#query').inputValue(), shown[0].query);
      assert.equal(runs, before, `${id} selection must not run a query`);
      await page.locator('#query').click();
      await page.locator('#query').press('ArrowUp');
      await page.locator('#query').press('Enter');
      assert.equal(await page.locator('#query').inputValue(), shown[3].query);
      await page.locator('#query').click();
      await page.locator('#query-suggestions [role=option]').first().click();
      assert.equal(await page.locator('#query-suggestions').isVisible(), false);
      assert.equal(runs, before);
      await page.locator('#query').press('Enter');
      await page.waitForFunction(() => document.querySelector('#status').textContent === 'Comparison complete.');
      assert.equal(await page.locator('#results').isVisible(), true, `S${i} results`);
      assert.equal(await page.locator('#status').getAttribute('class'), 'sr-only');
      assert.equal(await page.locator('#status').getAttribute('aria-live'), 'polite');
      assert.match(await page.locator('#results-title').textContent(), /Deterministic Sample mode/);
      assert.ok(await page.locator('#baseline .card').count() || await page.locator('#baseline .empty').count(), `S${i} baseline`);
      assert.ok(await page.locator('#enhanced .card').count() || await page.locator('#enhanced .empty').count(), `S${i} enhanced`);
      assert.equal(await page.locator('#baseline details.trace').getAttribute('open'), null);
      assert.equal(await page.locator('#enhanced details.trace').getAttribute('open'), null);
      const screenshot = await page.locator('.comparison').evaluate(el => {
        const [before, after] = [...el.children].map(item => item.getBoundingClientRect());
        return { beforeX: before.x, afterX: after.x, beforeY: before.y, afterY: after.y };
      });
      assert.ok(screenshot.afterX > screenshot.beforeX && screenshot.beforeY === screenshot.afterY);
    }
    // Evidence count lives in Advanced options.
    await page.locator('#settings-toggle').click();
    await page.selectOption('#count', '20');
    await page.locator('#reset').click();
    assert.equal(await page.locator('#scenario').inputValue(), 'S11');
    assert.equal(await page.locator('#count').inputValue(), '20');
    assert.equal(await page.locator('#query').inputValue(), '');
    assert.equal(await page.locator('#results').isVisible(), false);
    assert.equal(await page.locator('#metrics').textContent(), '');
    await page.selectOption('#scenario', 'S01');
    assert.notEqual(await page.locator('#query').inputValue(), '');
    await page.locator('#settings-toggle').click();
    assert.equal(await page.locator('#settings').isVisible(), true);
    await page.locator('#query').click();
    await page.locator('#query-suggestions [role=option]').nth(1).click();
    await page.locator('#query').press('Enter');
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Comparison complete.');
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.locator('.comparison').evaluate(el => {
      const [before, after] = [...el.children].map(item => item.getBoundingClientRect());
      return { beforeX: before.x, afterX: after.x, beforeY: before.y, afterY: after.y, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(mobile.beforeX, mobile.afterX);
    assert.ok(mobile.afterY > mobile.beforeY);
    assert.equal(mobile.overflow, false);
    await page.locator('#query').tap();
    await page.locator('#query-suggestions [role=option]').nth(2).tap();
    assert.equal(await page.locator('#query-suggestions').isVisible(), false);
    assert.equal(await page.locator('#query').inputValue(), catalog.scenarios[0].demoPresets[2].query);
    await page.locator('#query').fill('My own custom query');
    await page.locator('#query').press('Escape');
    assert.equal(await page.locator('#query').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#query').inputValue(), 'My own custom query');
    await page.locator('#reset').click();
    assert.equal(await page.locator('#query-suggestions').isVisible(), false);
    await page.selectOption('#scenario', 'S01');
    await page.route('**/api/demo/run', async route => {
      await new Promise(resolve => setTimeout(resolve, 300));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        mode: 'sample', query: 'STALE RESPONSE', executionStatus: 'success', baseline: { status: 'success', hits: [] }, enhanced: { status: 'success', hits: [] }, comparison: {},
      }) });
    });
    await page.locator('#query').press('Enter');
    await page.locator('#reset').click();
    await page.waitForTimeout(450);
    assert.equal(await page.locator('#results').isVisible(), false);
    assert.equal(await page.locator('#query').inputValue(), '');
    await page.selectOption('#scenario', 'S02');
    await page.locator('#query').press('Enter');
    await page.selectOption('#scenario', 'S03');
    await page.waitForTimeout(450);
    assert.equal(await page.locator('#results').isVisible(), false);
    assert.ok(!(await page.locator('body').textContent()).includes('STALE RESPONSE'));
    await page.selectOption('#scenario', 'S02');
    await page.locator('#query').press('Enter');
    await chooseLanguage(page, 'fr');
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Document language changed to Français'));
    await page.waitForTimeout(450);
    assert.equal(await page.locator('#results').isVisible(), false);
    assert.ok(!(await page.locator('body').textContent()).includes('STALE RESPONSE'));
    await page.unroute('**/api/demo/run');
    for (const language of ['fr', 'es', 'ja', 'de', 'en']) {
      const before = runs;
      await chooseLanguage(page, language);
      await page.waitForFunction(label => document.querySelector('#status').textContent.startsWith(`Document language changed to ${label}`),
        { fr: 'Français', es: 'Español', ja: '日本語', de: 'Deutsch', en: 'English' }[language]);
      if (language === 'en') {
        await page.locator('#settings-toggle').click();
        await page.selectOption('#mode', 'sample');
        await page.locator('#settings-toggle').click();
      }
      const localized = await (await page.request.get(serverEnv.PUBLIC_ORIGIN + `/api/scenarios?language=${language}`)).json();
      for (const scenario of localized.scenarios) {
        await page.selectOption('#scenario', scenario.id);
        await page.locator('#query').click();
        const presets = await page.locator('#query-suggestions [role=option]').allTextContents();
        const shown = shownPresets(scenario, language === 'en');
        assert.deepEqual(presets.map(label => label.trim()), shown.map(preset => preset.label));
        await page.locator('#query-suggestions [role=option]').first().click();
        assert.equal(await page.locator('#query').inputValue(), shown[0].query);
      }
      await page.locator('#query').fill('Editable custom query');
      await page.locator('#query').press('Escape');
      await page.locator('#reset').click();
      assert.equal(await page.locator(`input[name="document-language"][value="${language}"]`).isChecked(), true);
      assert.equal(await page.locator('#count').inputValue(), '20');
      assert.equal(await page.locator('#query').inputValue(), '');
      assert.equal(await page.locator('#results').isVisible(), false);
      assert.equal(runs, before, 'Language/preset changes must not run a query');
    }
    await page.selectOption('#scenario', 'S03');
    await page.locator('#settings-toggle').click();
    await page.selectOption('#mode', 'live');
    await page.locator('#search').click();
    await page.waitForFunction(() => !document.querySelector('#error').hidden);
    assert.equal(await page.locator('#results').isVisible(), false);
    assert.equal(await page.locator('#mode-badge').isVisible(), false);
    assert.equal(await page.locator('#status').getAttribute('class'), '');
    await page.route('**/api/scenarios*', async route => {
      const response = await route.fetch();
      const catalog = await response.json();
      catalog.scenarios.find(item => item.id === 'S11').liveAvailable = true;
      await route.fulfill({ response, json: catalog });
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#scenario').options.length === 11);
    await page.selectOption('#scenario', 'S11');
    await page.locator('#settings-toggle').click();
    await page.selectOption('#mode', 'live');
    let preparations = 0;
    await page.route('**/api/demo/prepare', route => route.fulfill({ json: ++preparations === 1
      ? { ready: false, retryAfter: 1, phase: 'comparison' } : { ready: true } }));
    let submitted, completeLive = false, rejectLive = false;
    await page.route('**/api/demo/run', async route => {
      submitted = route.request().postDataJSON();
      if (rejectLive) return route.fulfill({ status: 503, json: { error: 'Search is temporarily unavailable. Try again shortly.' } });
      if (completeLive) {
        await new Promise(resolve => setTimeout(resolve, 200));
        return route.fulfill({ json: {
          mode: 'live', query: submitted.query, executionStatus: 'success',
          baseline: { status: 'success', kind: 'metadata', hits: [] },
          enhanced: { status: 'success', kind: 'image', hits: [] }, comparison: {},
        } });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        mode: 'live', query: submitted.query, executionStatus: 'partial_success',
        baseline: { status: 'success', kind: 'metadata', hits: [] },
        enhanced: { status: 'error', error: { message: 'Simulated encoder failure; no fallback.' }, hits: [] }, comparison: {},
      }) });
    });
    const beforePreset = runs;
    await page.locator('#query').click();
    assert.ok((await page.locator('#query-suggestions').textContent()).includes('Bundled blue hat - image only'));
    await page.locator('#query-suggestions [role=option]').first().click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Bundled synthetic image'));
    assert.equal(runs, beforePreset);
    assert.equal(await page.locator('#query').inputValue(), '');
    assert.equal(await page.locator('#query-suggestions').isVisible(), false);
    const bundled = await (await page.request.get(serverEnv.PUBLIC_ORIGIN + '/samples/zava-hat-blue.png')).body();
    await page.locator('#search').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('allowance resets'));
    assert.equal(runs, beforePreset);
    await page.locator('#cancel').click();
    await page.waitForTimeout(2100);
    assert.equal(runs, beforePreset);
    await page.locator('#search').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Partial success'));
    assert.equal(submitted.imageInput.base64, bundled.toString('base64'));
    assert.equal(submitted.query, 'Image-only reference search');
    await page.locator('#reset').click();
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=', 'base64');
    await page.locator('#file').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: image });
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('ephemeral'));
    await page.locator('#search').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Partial success'));
    assert.equal(submitted.imageInput.mimeType, 'image/png');
    assert.equal(submitted.imageInput.base64, image.toString('base64'));
    assert.equal(submitted.query, 'Image-only reference search');
    assert.equal(submitted.uploadId, undefined);
    assert.ok((await page.locator('#enhanced').textContent()).includes('Simulated encoder failure'));
    assert.equal(await page.locator('#status').getAttribute('class'), '');
    for (const language of ['fr', 'es', 'ja', 'de']) {
      await chooseLanguage(page, language);
      await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Document language changed'));
      const localized = await (await page.request.get(serverEnv.PUBLIC_ORIGIN + `/api/scenarios?language=${language}`)).json();
      await page.locator('#query').click();
      await page.locator('#query-suggestions [role=option]').first().click();
      await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Bundled synthetic image'));
      assert.equal(await page.locator('#query').inputValue(), '');
      await page.locator('#search').click();
      await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Partial success'));
      assert.equal(submitted.language, language);
      assert.equal(submitted.query, localized.scenarios.find(item => item.id === 'S11').imageOnlyQuery);
      assert.equal(submitted.imageInput.base64, bundled.toString('base64'));
    }
    await chooseLanguage(page, 'en');
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Document language changed'));
    await page.locator('#query').click();
    await page.locator('#query-suggestions [role=option]').first().click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Bundled synthetic image'));
    completeLive = true;
    await page.locator('#search').click();
    assert.equal(await page.locator('#status').getAttribute('class'), '');
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Comparison complete.');
    assert.equal(await page.locator('#status').getAttribute('class'), 'sr-only');
    assert.equal(await page.locator('.status-row').evaluate(el => el.getBoundingClientRect().height), 0);
    assert.equal(await page.locator('#mode-badge').isVisible(), false);
    assert.doesNotMatch(await page.locator('#results-title').textContent(), /Live|complete/i);
    assert.equal(await page.locator('#settings').isVisible(), false);
    const provenance = await page.locator('#enhanced > details pre').textContent();
    assert.equal(JSON.parse(provenance).executionMode, 'live');
    assert.equal(await page.locator('#enhanced > details').getAttribute('open'), null);
    rejectLive = true;
    await page.locator('#search').click();
    await page.waitForFunction(() => !document.querySelector('#error').hidden);
    assert.match(await page.locator('#error').textContent(), /temporarily unavailable.*Try again/);
    assert.equal(await page.locator('#status').getAttribute('class'), '');
    assert.equal(await page.locator('#results').isVisible(), false);
    await page.locator('#reset').click();
    assert.equal(await page.locator('#file-preview').isVisible(), false);
    await page.route('**/samples/zava-hat-red.png', async route => {
      const response = await route.fetch();
      await new Promise(resolve => setTimeout(resolve, 300));
      await route.fulfill({ response });
    });
    await page.locator('#query').click();
    await page.locator('#query-suggestions [role=option]').nth(2).click();
    await page.selectOption('#scenario', 'S10');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#file-preview').isVisible(), false);
    assert.equal(await page.locator('#query').inputValue(), catalog.scenarios[9].sampleQuery);
    await page.locator('#query').click();
    assert.deepEqual(await page.locator('#query-suggestions [role=option]').allTextContents(), catalog.scenarios[9].demoPresets.map(preset => preset.label));
    await page.locator('#query').press('Escape');
    await page.selectOption('#scenario', 'S10');
    await page.locator('#file').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid-pdf') });
    await page.waitForFunction(() => !document.querySelector('#error').hidden);
    assert.ok((await page.locator('#error').textContent()).includes('Invalid file signature'));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.closeAllConnections();
    server.close();
  }
});
