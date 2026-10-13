/**
 * Parcours de bout en bout dans un vrai navigateur (Chromium), en mode démonstration.
 * Prérequis : `npm run build` (sans projet Supabase configuré → mode démonstration).
 * Usage : npm run test:e2e   — captures d'écran dans test-results/
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { chromium, type Page } from 'playwright';

const root = join(import.meta.dirname, '..', '..');
const dist = join(root, 'dist');
const out = join(root, 'test-results');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

async function serve(): Promise<{ url: string; close: () => void }> {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    const file = join(dist, path === '/' ? 'index.html' : path);
    if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('serveur');
  return { url: `http://127.0.0.1:${addr.port}/`, close: () => server.close() };
}

const results: { name: string; ok: boolean; error?: string }[] = [];
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`OK   ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e) });
    console.log(`ÉCHEC ${name}\n     ${String(e).split('\n').slice(0, 4).join('\n     ')}`);
  }
}

async function noHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw + 1, `défilement horizontal : ${sw}px > ${iw}px`);
}

async function main() {
  if (!existsSync(join(dist, 'index.html'))) throw new Error('Lancez d’abord npm run build');
  await mkdir(out, { recursive: true });
  const { url, close } = await serve();
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await step('ouverture en mode démonstration, bannière visible', async () => {
    await page.goto(url);
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    await page.getByText('Mode démonstration').first().waitFor();
    await page.screenshot({ path: join(out, '01-tableau-de-bord-vide.png') });
  });

  await step('menu complet, sans états des lieux', async () => {
    const labels = await page.locator('#main-nav a').allInnerTexts();
    for (const l of ['Tableau de bord', 'Prospection', 'Simulateur', 'Mes biens', 'Locataires et baux', 'Loyers et paiements', 'Dépenses', 'Contacts', 'Documents', 'Synthèse annuelle', 'Mon abonnement', 'Paramètres']) {
      assert.ok(labels.some((x) => x.includes(l)), `menu : ${l}`);
    }
    const js = await page.evaluate(async () => {
      const src = (document.querySelector('script[type=module]') as HTMLScriptElement).src;
      return (await fetch(src)).text();
    });
    assert.ok(!/[ée]tats? des lieux/i.test(js), 'aucune mention des états des lieux dans le code livré');
    assert.ok(!/etat-des-lieux|etats-des-lieux|edl/i.test(await page.content()), 'aucune route états des lieux');
  });

  await step('ajout d’un bien en prospection avec nouvelle agence', async () => {
    await page.goto(url + '#/prospection');
    await page.getByRole('button', { name: 'Ajouter un premier bien' }).click();
    await page.getByLabel('Titre *').fill('T3 test balcon');
    await page.getByLabel('Ville').fill('Montreuil');
    await page.getByLabel('Surface').fill('62,5');
    await page.getByLabel('Prix affiché').fill('320 000');
    await page.getByLabel('Prix proposé').fill('300000');
    await page.getByLabel('Loyer estimé hors charges').fill('1350');
    await page.getByLabel('Agence', { exact: true }).selectOption({ label: '+ Nouvelle agence…' });
    await page.getByLabel('Nom de la nouvelle agence').fill('Agence Test');
    await page.getByLabel('Date de relance').fill('2020-01-01');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.getByRole('heading', { name: 'T3 test balcon' }).waitFor();
    await page.getByRole('tab', { name: /Historique/ }).click();
    await page.getByText('Bien ajouté à la prospection').first().waitFor();
  });

  await step('validation : titre obligatoire, URL invalide', async () => {
    await page.goto(url + '#/bien/nouveau?mode=prospect');
    await page.getByLabel('Lien de l’annonce').fill('ftp://x');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.getByText('Le titre est obligatoire.').waitFor();
    await page.getByText('Adresse web commençant par').waitFor();
  });

  await step('simulation liée au bien, enregistrée comme scénario principal', async () => {
    await page.goto(url + '#/prospection');
    await page.getByRole('button', { name: 'T3 test balcon' }).first().click();
    await page.getByRole('button', { name: 'Simuler' }).click();
    await page.getByLabel('Apport').fill('40000');
    await page.getByLabel('Taxe foncière').fill('1100');
    const cash = await page.locator('.cashflow strong').innerText();
    assert.match(cash, /€/);
    await page.screenshot({ path: join(out, '02-simulateur.png'), fullPage: true });
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByText('Simulation enregistrée.').waitFor();
    await page.getByRole('button', { name: 'Par année' }).click();
    assert.ok(await page.locator('table.compact tbody tr').count() === 20, '20 lignes annuelles');
  });

  await step('valeurs invalides bloquent l’enregistrement', async () => {
    await page.getByLabel('Durée').fill('0');
    await page.getByText('Durée entière entre 1 et 40 ans.').first().waitFor();
    assert.ok(await page.getByRole('button', { name: 'Enregistrer', exact: true }).isDisabled());
    await page.getByLabel('Durée').fill('20');
  });

  await step('tableau prospection : rendement, cash-flow, relance', async () => {
    await page.goto(url + '#/prospection');
    const row = page.locator('tbody tr', { hasText: 'T3 test balcon' });
    await row.waitFor();
    const text = (await row.innerText()).replace(/[\u202f\u00a0]/g, ' ');
    assert.match(text, /4,87 %/, 'rendement brut affiché (16 200 / 332 500)');
    assert.match(text, /4 800 €/, 'prix au m² (300 000 / 62,5)');
    await page.getByLabel(/Relances à faire/).check();
    assert.ok(await page.locator('tbody tr', { hasText: 'T3 test balcon' }).count() === 1);
    await page.getByLabel(/Relances à faire/).uncheck();
    await page.screenshot({ path: join(out, '03-prospection.png') });
  });

  await step('colonnes personnalisables et tri', async () => {
    await page.getByText('Colonnes', { exact: true }).click();
    await page.locator('.menu-columns').getByLabel('Agence').check();
    await page.locator('thead').getByText('Agence').waitFor();
    await page.getByText('Colonnes', { exact: true }).click();
    await page.locator('thead').getByRole('button', { name: /Prix affiché/ }).click();
    assert.equal(await page.locator('thead th[aria-sort="ascending"]').count(), 1);
  });

  let duplicateOk = false;
  await step('duplication et comparaison', async () => {
    const row = page.locator('tbody tr', { hasText: 'T3 test balcon' }).first();
    await row.getByLabel('Actions').click();
    await row.getByRole('menuitem', { name: 'Dupliquer' }).click();
    await page.getByRole('heading', { name: 'T3 test balcon (copie)' }).waitFor();
    await page.goto(url + '#/prospection');
    await page.getByLabel('Tout sélectionner sur cette page').check();
    await page.getByRole('button', { name: 'Comparer' }).click();
    await page.getByRole('heading', { name: 'Comparer les biens' }).waitFor();
    await page.screenshot({ path: join(out, '04-comparaison.png') });
    await page.locator('dialog[open]').getByRole('button', { name: 'Fermer' }).click();
    duplicateOk = true;
  });

  await step('export Excel réel (.xlsx) et CSV', async () => {
    const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel (.xlsx)' }).click()]);
    assert.match(xlsx.suggestedFilename(), /\.xlsx$/);
    const buf = await readFile((await xlsx.path())!);
    const zip = await JSZip.loadAsync(buf);
    assert.ok(zip.file('xl/workbook.xml') && zip.file('xl/worksheets/sheet1.xml'), 'structure OOXML');
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    assert.ok(sheet.includes('T3 test balcon'));
    assert.ok(!buf.subarray(0, 100).toString().includes('<html'), 'pas un HTML renommé');
    await xlsx.saveAs(join(out, 'export-prospection.xlsx'));
    const [csv] = await Promise.all([page.waitForEvent('download'), page.locator('.export-row').getByRole('button', { name: 'CSV' }).click()]);
    const text = await readFile((await csv.path())!, 'utf8');
    assert.ok(text.startsWith('﻿Titre;'), 'CSV UTF-8 avec en-tête');
    assert.match(text, /300000,00/);
  });

  let propertyId = '';
  await step('passage à « Acquis » : transfert vers Mes biens sans duplication', async () => {
    await page.goto(url + '#/prospection');
    await page.getByRole('button', { name: 'T3 test balcon', exact: true }).first().click();
    propertyId = page.url().split('/bien/')[1]!;
    await page.getByRole('button', { name: 'Marquer comme acquis' }).click();
    await page.getByRole('button', { name: 'Transférer dans Mes biens' }).click();
    await page.getByText('est maintenant dans Mes biens').waitFor();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('immozen:demo:v1')!).properties.length);
    await page.goto(url + '#/prospection');
    await page.locator('.datatable').waitFor();
    assert.equal(await page.locator('tbody tr', { hasText: /^T3 test balcon$/ }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'T3 test balcon', exact: true }).count(), 0, 'absent de la prospection');
    await page.goto(url + '#/biens');
    await page.getByRole('button', { name: 'T3 test balcon', exact: true }).first().click();
    assert.equal(page.url().split('/bien/')[1], propertyId, 'même identifiant');
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('immozen:demo:v1')!).properties.length);
    assert.equal(after, before, 'aucun bien créé');
    await page.getByText('Photographie à l’acquisition').waitFor();
    await page.getByRole('tab', { name: /Historique/ }).click();
    await page.getByText('Bien acquis : transféré dans Mes biens').waitFor();
    await page.getByText('Bien ajouté à la prospection').waitFor();
    await page.screenshot({ path: join(out, '05-fiche-bien-acquis.png'), fullPage: true });
  });

  await step('ajout direct d’un bien déjà détenu', async () => {
    await page.goto(url + '#/biens');
    await page.getByRole('button', { name: 'Ajouter un bien détenu' }).first().click();
    await page.getByLabel('Titre *').fill('Parking détenu');
    await page.getByLabel('Mode de détention').selectOption('nom_propre');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.getByRole('heading', { name: 'Parking détenu' }).waitFor();
    await page.goto(url + '#/biens');
    await page.getByRole('button', { name: 'Parking détenu' }).waitFor();
    await page.screenshot({ path: join(out, '06-mes-biens.png') });
  });

  await step('conflit : une modification concurrente n’écrase rien en silence', async () => {
    await page.goto(url + `#/bien/${propertyId}/modifier`);
    await page.getByLabel('Titre *').fill('Titre local');
    // modification « depuis un autre appareil »
    await page.evaluate((id) => {
      const db = JSON.parse(localStorage.getItem('immozen:demo:v1')!);
      const p = db.properties.find((x: { id: string }) => x.id === id);
      p.title = 'Titre distant'; p.version += 1;
      localStorage.setItem('immozen:demo:v1', JSON.stringify(db));
    }, propertyId);
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.getByRole('heading', { name: 'Modification concurrente' }).waitFor();
    await page.getByRole('button', { name: 'Recharger la version enregistrée' }).click();
    const title = await page.evaluate((id) => JSON.parse(localStorage.getItem('immozen:demo:v1')!).properties.find((x: { id: string }) => x.id === id).title, propertyId);
    assert.equal(title, 'Titre distant');
  });

  await step('contacts : agence créée depuis le bien, échanges', async () => {
    await page.goto(url + '#/contacts');
    await page.getByRole('button', { name: 'Agence Test' }).click();
    await page.getByText(/Biens liés \(\d\)/).waitFor();
    await page.getByLabel('Compte rendu').fill('Appel : dossier complet envoyé');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page.getByText('Appel : dossier complet envoyé').waitFor();
  });

  await step('sauvegarde JSON puis réimport sans doublon', async () => {
    await page.goto(url + '#/parametres');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger une sauvegarde (.json)' }).click()]);
    const file = join(out, 'sauvegarde.json');
    await dl.saveAs(file);
    await page.locator('input[type=file]').setInputFiles(file);
    await page.getByRole('heading', { name: /Importer/ }).waitFor();
    const cells = await page.locator('.modal tbody tr').first().locator('td').allInnerTexts();
    assert.equal(cells[1], '0', 'aucun bien ajouté');
    assert.notEqual(cells[2], '0', 'doublons détectés');
    await page.getByRole('button', { name: 'Annuler' }).click();
  });

  await step('reprise des simulations IDF Invest restées dans le navigateur', async () => {
    await page.evaluate(() => localStorage.setItem('idf-invest-v6:abc', JSON.stringify({ simulations: [{ id: '9b2c1f00-0000-4000-8000-000000000001', number: 'SIM-2026-0007', title: 'Ancienne simulation', status: 'Offre en cours', surface: 30, offerPrice: 140000, loanYears: 20, rentLevel: 'Personnalisé', customRent: 700, agency: 'agence test', archived: false }] })));
    await page.reload();
    await page.getByText('1 simulation(s) IDF Invest').waitFor();
    page.once('download', () => undefined);
    await page.getByRole('button', { name: 'Reprendre ces simulations' }).click();
    await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
    await page.getByText('1 simulation(s) IDF Invest reprise(s).').waitFor();
    const db = await page.evaluate(() => JSON.parse(localStorage.getItem('immozen:demo:v1')!));
    const p = db.properties.find((x: { title: string }) => x.title === 'Ancienne simulation');
    assert.equal(p.status, 'offre_transmise');
    assert.equal(db.pro_contacts.filter((c: { kind: string }) => c.kind === 'agence').length, 1, 'agence dédoublonnée');
    await page.getByText('Aucune simulation IDF Invest en attente').waitFor();
  });

  await step('rubriques des lots suivants clairement signalées', async () => {
    for (const r of ['locataires', 'loyers', 'depenses', 'documents', 'synthese', 'abonnement']) {
      await page.goto(url + `#/${r}`);
      await page.getByText(/n’est pas encore disponible/).waitFor();
    }
  });

  await step('rendu mobile (390 px) sans défilement horizontal', async () => {
    const m = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    await mp.goto(url);
    await mp.evaluate((s) => localStorage.setItem('immozen:demo:v1', s), await page.evaluate(() => localStorage.getItem('immozen:demo:v1')!));
    for (const [path, shot] of [['', '07-mobile-tableau-de-bord'], ['#/prospection', '08-mobile-prospection'], ['#/simulateur', '09-mobile-simulateur'], [`#/bien/${propertyId}`, '10-mobile-fiche']] as const) {
      await mp.goto(url + path);
      await mp.reload();
      await mp.locator('main h1').first().waitFor();
      await noHorizontalScroll(mp);
      await mp.screenshot({ path: join(out, `${shot}.png`), fullPage: path === '#/simulateur' ? false : true });
    }
    await mp.goto(url + '#/prospection');
    assert.ok(await mp.locator('.dt-card').count() > 0, 'cartes affichées sur mobile');
    await mp.getByRole('button', { name: 'Menu' }).click();
    await mp.locator('#main-nav.open').waitFor();
    await mp.screenshot({ path: join(out, '11-mobile-menu.png') });
    await m.close();
  });

  await step('déconnexion : purge des données locales privées', async () => {
    await page.goto(url);
    await page.evaluate(() => localStorage.setItem('immozen:cache:test', '{"x":1}'));
    await page.getByRole('button', { name: 'Déconnexion' }).click();
    await page.getByRole('heading', { name: 'Connexion' }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('immozen:cache:test')), null);
  });

  await step('aucune erreur JavaScript', async () => {
    assert.deepEqual(errors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND/.test(e)), []);
  });

  void duplicateOk;
  await browser.close();
  close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} étapes réussies`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
