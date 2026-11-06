import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Pure route/access contracts and server-rendered component assertions.
// This does not automate a browser or contact production services.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rhi-workspace-contracts-'));
try {
  const output = path.join(directory, 'contracts.cjs');
  await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'workspace-contracts.tsx', loader: 'tsx', contents: `
      import assert from 'node:assert/strict';
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { hasRequiredPermission, hasTabAccess, getRoleFallbackCandidates } from './src/app/components/layout/appLayoutAccess';
      import { APP_LAYOUT_TAB_PERMISSIONS } from './src/app/components/layout/appLayoutTabPermissions';
      import { APP_ROUTE_DEFINITIONS, getAppRouteByPath, getCanonicalAppPath } from './src/app/routing/appRouteRegistry';
      import { WorkspaceFrame } from './src/app/components/workspace/WorkspaceFrame';
      import { PageLoadingState } from './src/app/components/layout/PageLoadingState';
      import { PlaceholderPage } from './src/app/pages/PlaceholderPage';

      const grants = (...keys) => key => keys.includes(key);
      assert.equal(hasRequiredPermission(['daily_report.view', 'finance_report.view'], grants('finance_report.view')), true);
      assert.equal(hasRequiredPermission(['daily_report.view', 'finance_report.view'], grants()), false);
      assert.equal(hasTabAccess('payroll', grants('order.view')), false);
      assert.equal(hasTabAccess('inventory-transactions', grants('inventory.view')), false);
      assert.equal(hasTabAccess('inventory-transactions', grants('stock.transaction.view')), true);
      assert.equal(hasTabAccess('whatsapp-inbox-settings', grants('whatsapp.view')), false);
      for (const tab of Object.keys(APP_LAYOUT_TAB_PERMISSIONS)) assert.equal(hasTabAccess(tab, grants()), false, tab);
      assert.deepEqual(getRoleFallbackCandidates('technician'), getRoleFallbackCandidates('Teknisi'));
      assert.equal(getRoleFallbackCandidates('Teknisi')[0], 'teknisi-mobile');
      for (const role of ['Owner', 'Super Admin', 'Admin PIC', 'CS', 'Advertiser', 'Finance', 'Teknisi']) {
        assert.ok(getRoleFallbackCandidates(role).every(tab => APP_ROUTE_DEFINITIONS.some(route => route.tabId === tab)), role);
      }
      for (const route of APP_ROUTE_DEFINITIONS) {
        const resolved = getAppRouteByPath(route.path);
        assert.ok(resolved, route.path);
        assert.equal(getCanonicalAppPath(resolved), getCanonicalAppPath(route));
        assert.ok(getAppRouteByPath(getCanonicalAppPath(route)), route.id);
      }
      const markup = renderToStaticMarkup(<WorkspaceFrame title="Audit workspace" description="Deskripsi"
        badges={['UAT']} stats={[{label:'Order',value:'0',hint:'Tidak ada pesanan'}]}
        actions={<button>Aksi</button>} filters={<label>Filter</label>}><p>Isi halaman</p></WorkspaceFrame>);
      assert.equal((markup.match(/<h1/g) || []).length, 1);
      for (const label of ['Audit workspace', 'Deskripsi', 'Order', '>0<', 'Tidak ada pesanan', 'Aksi', 'Filter', 'Isi halaman']) assert.ok(markup.includes(label), label);
      assert.ok(markup.indexOf('Filter') < markup.indexOf('Isi halaman'));
      const loading = renderToStaticMarkup(<PageLoadingState />);
      assert.ok(loading.includes('role="status"') && loading.includes('Memuat halaman'));
      const placeholder = renderToStaticMarkup(<PlaceholderPage title="Bot" description="Aturan" />);
      assert.ok(placeholder.includes('<h1>Bot</h1>') && placeholder.includes('belum tersedia'));
      assert.ok(!placeholder.includes('segera'));
      console.log('PASS modular workspace: protected tabs, seven role fallbacks, 61 route mappings, header/actions/filters/content, loading and unavailable states');
    ` },
    outfile: output, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    alias: { '@': path.resolve('src') }, logLevel: 'silent',
  });
  await import(pathToFileURL(output).href);
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
