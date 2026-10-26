import {before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {startFixture, playSong, stopListening} from './browser_helpers.mjs';
let fixture;
before(async () => {fixture = await startFixture();});
after(async () => {if(fixture) await fixture.close();});

test('ordinary audio can play pause resume and stop', async () => {
  const {page, context, profile, errors} = await fixture.page();
  try {
    await playSong(page, profile.songs[0]);
    await page.locator('#audio-player').getByRole('button', {name:'Pause',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('#audio-player audio').paused);
    await page.locator('#audio-player').getByRole('button', {name:'Play',exact:true}).click();
    await page.waitForFunction(() => !document.querySelector('#audio-player audio').paused);
    await stopListening(page);
    assert.deepEqual(errors, []);
  } finally {await context.close();}
});

test('profiles require a session and other listeners cannot control the owner songs', async () => {
  const anonymous = await fixture.browser.newContext();
  try {
    const page = await anonymous.newPage();
    await page.goto(`http://127.0.0.1:4002/${fixture.data.profiles[0].username}`);
    assert.equal(new URL(page.url()).pathname, '/signin');
  } finally {await anonymous.close();}
  const {page, context, errors} = await fixture.page();
  try {
    const owner = fixture.data.profiles[5];
    await page.goto(`http://127.0.0.1:4002/${owner.username}`);
    await page.waitForSelector('#player.phx-connected');
    await page.locator(`#song-${owner.songs[0].id} td`).first().click();
    // Roundtrip through the real view then inspect the local audio and row.
    await page.getByRole('button', {name:'Listen',exact:true}).click();
    await page.getByRole('button', {name:'Stop Listening',exact:true}).waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('#audio-player audio').paused), true);
    assert.equal(await page.locator(`#song-${owner.songs[0].id} [aria-label="Playing"]`).count(), 0);
    assert.deepEqual(errors, []);
  } finally {await context.close();}
});
