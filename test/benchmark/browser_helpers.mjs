import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.EAB_BROWSER_MODULE);

export async function startFixture() {
  // Rebuild edited JavaScript after the grader has applied the submitted patch.
  execFileSync('mix', ['esbuild', 'default'], {timeout:60000, stdio:'pipe'});
  const server = spawn('mix', ['run', '--no-start', 'test/benchmark/server.exs'], {detached:true, stdio:['ignore','pipe','pipe']});
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local application setup did not become ready: ' + output.slice(-6000))), 60000);
    server.stdout.on('data', data => {
      output += data;
      const line = output.split('\n').find(x => x.startsWith('EAB_BROWSER_READY '));
      if (line) {clearTimeout(timer); resolve(JSON.parse(line.slice('EAB_BROWSER_READY '.length)));}
    });
    server.stderr.on('data', data => {output += data;});
    server.once('exit', code => {clearTimeout(timer); reject(new Error(`Application setup exited ${code}: ${output.slice(-6000)}`));});
  });
  let browser;
  const close = async () => {
    if (browser) await browser.close();
    if (server.exitCode === null) {
      const exited = once(server, 'exit');
      try {process.kill(-server.pid, 'SIGTERM');} catch(error) {if(error.code !== 'ESRCH') throw error;}
      await exited;
    }
  };
  try {
    const data = await ready;
    browser = await chromium.launch({headless:true, args:['--no-sandbox']});
    let next = 0;
    return {browser, data, close, async page({mediaSession = true, profileIndex} = {}) {
      const profile = data.profiles[profileIndex ?? next++];
      assert.ok(profile, 'Fixture profile exists');
      const context = await browser.newContext();
      if (!mediaSession) await context.addInitScript(() => {delete Navigator.prototype.mediaSession;});
      // External avatar/region imagery is unrelated to the local product workflow.
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        return ['127.0.0.1','localhost'].includes(url.hostname) ? route.continue() : route.abort();
      });
      await context.addCookies([{name:'_live_beats_key_v1',value:profile.cookie,url:'http://127.0.0.1:4002'}]);
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:4002/${profile.username}`);
      await page.waitForSelector('#player.phx-connected');
      await page.waitForSelector('[data-phx-main].phx-connected');
      await page.locator(`#song-${profile.songs[0].id}`).waitFor();
      return {page, context, profile, errors};
    }};
  } catch(error) {await close(); throw error;}
}

export async function playSong(page, song) {
  await page.locator(`#song-${song.id} td`).first().click();
  // The ordinary click triggers LiveView -> PubSub -> player -> real audio.
  await page.waitForFunction(filename => {
    const audio = document.querySelector('#audio-player audio');
    const prompt = document.querySelector('#enable-audio-confirm');
    return audio?.src.includes(filename) && ((!audio.paused && audio.readyState >= 2) || (prompt && prompt.getClientRects().length > 0));
  }, song.filename);
  const listen = page.getByRole('button', {name:'Listen Now', exact:true});
  if (await listen.isVisible()) await listen.click();
  await page.waitForFunction(filename => {
    const audio = document.querySelector('#audio-player audio');
    return audio && audio.src.includes(filename) && !audio.paused && audio.readyState >= 2;
  }, song.filename);
}
export async function stopListening(page) {
  await page.getByRole('button', {name:'Stop Listening', exact:true}).click();
  await page.waitForFunction(() => {
    const audio = document.querySelector('#audio-player audio');
    return audio.paused && audio.currentTime === 0 && !document.querySelector('#audio-player h2').textContent.trim();
  });
}
