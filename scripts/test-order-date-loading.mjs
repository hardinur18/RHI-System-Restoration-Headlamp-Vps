import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const source = await fs.readFile('src/app/pages/master-data/context/MasterDataCtx.tsx', 'utf8');
const fetchAndEnsure = source.slice(source.indexOf('  const fetchRangeRows ='), source.indexOf('  const ensureLeadsForDateRange ='));
const priorityHelper = source.slice(source.indexOf('  const fetchTodayOrdersDirectly ='), source.indexOf('  const fetchTodayLeadsDirectly ='));
const priorityLoader = source.slice(source.indexOf('      const fetchPriorityOrders ='), source.indexOf('      fetchPriorityOrders().catch'));
if (!fetchAndEnsure.includes('const ensureOrdersForDateRange')) throw new Error('Loader extraction failed');
await fs.mkdir('.tmp', { recursive: true });
const directory = await fs.mkdtemp(path.resolve('.tmp/order-date-loading-'));
try {
  const outfile = path.join(directory, 'test.mjs');
  await build({ stdin: { resolveDir: process.cwd(), sourcefile: 'order-date-loading-test.tsx', loader: 'tsx', contents: `
    import assert from 'node:assert/strict';
    import React from 'react';
    import { create, act } from 'react-test-renderer';
    import { useOrderDateLoading } from './src/app/pages/orders/hooks/useOrderDateLoading';
    import { mapFetchedRows, mergeRowsById, toBusinessDayUtcRange } from './src/app/pages/master-data/context/internal/masterDataRangeUtils';
    const today = {from:new Date(2026,10,10),to:new Date(2026,10,10)};
    let dataset = Array.from({length:1201}, (_,i)=>({id:String(i),service_date:i<17?'2026-11-10':i===1200?null:'2026-11-09',technician_id:i%2?'a':'b'}));
    const requests = [];
    let fail = false, view, api, reset, bootstrap, holdNext, releaseHeld;
    const startPerfTimer = () => () => {};
    const CACHEABLE_RANGE_TABLES = new Set();
    const mapOrderFromDB = row => row;
    function Probe({range,ready=true}) {
      const [orders,setOrders] = React.useState(dataset.slice(0,17));
      const orderLoadGenerationRef = React.useRef(0);
      const fetchedOrderDateRangesRef = React.useRef(new Set());
      const fetchingOrderDateRangesRef = React.useRef(new Map());
      const fetchDirectAppDataPage = async (table,from,to,options) => {
        requests.push({from,to,options});
        if(fail) throw new Error('network fixture');
        let rows=dataset;
        for(const [k,v] of Object.entries(options.gte||{})) rows=rows.filter(r=>r[k]!=null&&r[k]>=v);
        for(const [k,v] of Object.entries(options.lte||{})) rows=rows.filter(r=>r[k]!=null&&r[k]<=v);
        for(const [k,v] of Object.entries(options.eq||{})) rows=rows.filter(r=>r[k]===v);
        const result=rows.slice(from,to+1);
        if(holdNext){holdNext=false;await new Promise(resolve=>{releaseHeld=resolve;});}
        return result;
      };
      const fetchAppDataPage = async (...args)=>({rows:await fetchDirectAppDataPage(...args),forbidden:false});
      ${fetchAndEnsure}
      ${priorityHelper}
      const orderFetch = {setter:setOrders,mapper:rows=>rows};
      const getTodayDateKey = ()=>'2026-11-10';
      const shouldUseTechnicianLightBootstrap=false,shouldUseTechnicianScopedOrdersBootstrap=false,shouldFetchFullOperationalHistory=false;
      const currentUser=null,currentRole='Owner',normalizedActivePath='/orders',isCancelled=false;
      const recordPerfMetric=()=>{},setIsOrdersLoading=()=>{};
      ${priorityLoader}
      bootstrap=fetchPriorityOrders;
      api=ensureOrdersForDateRange;
      reset=()=>{orderLoadGenerationRef.current+=1;fetchedOrderDateRangesRef.current.clear();setOrders(dataset.slice(0,17));};
      view={orders,...useOrderDateLoading(range,'service',ensureOrdersForDateRange,ready)};
      return null;
    }
    let root;
    await act(async()=>{root=create(<Probe range={today}/>)});
    assert.equal(view.orders.length,17);
    requests.length=0;
    await act(async()=>{root.update(<Probe range={undefined}/>)});
    assert.equal(view.orders.length,1201,'All Time must fetch history beyond the initial 17 rows');
    assert.equal(view.orders.filter(r=>r.service_date===null).length,1,'All Time includes unscheduled orders');
    assert.deepEqual(requests.map(r=>r.from),[0,500,1000],'Fetch every page, not just the first 500');
    assert(requests.every(r=>!r.options.gte&&!r.options.lte));
    const count=requests.length;
    await act(async()=>{await api({mode:'lead'});});
    assert.equal(requests.length,count,'All history is reused across date modes');
    await act(async()=>{await api({technicianId:'a'});});
    assert.equal(requests.at(-1).options.eq.technician_id,'a');
    await act(async()=>{root.update(<Probe range={undefined} ready={false}/>);reset();});
    const before=requests.length;
    dataset.push({id:'new',service_date:null,technician_id:'a'});
    await act(async()=>{root.update(<Probe range={undefined} ready={true}/>);});
    assert.equal(view.orders.length,1202,'Refresh must reload the selected all-time scope');
    assert(requests.length>before);
    await act(async()=>root.unmount());
    requests.length=0;
    await act(async()=>{root=create(<Probe range={today} ready={false}/>)});
    await act(async()=>bootstrap());
    assert.equal(requests.length,1,'Today bootstrap makes one request for a short page');
    await act(async()=>root.update(<Probe range={today} ready={true}/>));
    assert.equal(requests.length,1,'Opening today must reuse the completed bootstrap');
    assert.equal(view.loading,false);
    // More than the old 250-row cap must be completely fetched before caching.
    dataset=Array.from({length:301},(_,i)=>({id:String(i),service_date:'2026-11-10',technician_id:'a'}));
    await act(async()=>{root.update(<Probe range={today} ready={false}/>);reset();});
    requests.length=0;
    await act(async()=>bootstrap());
    assert.equal(view.orders.length,301);
    assert.deepEqual(requests.map(r=>r.from),[0,250]);
    await act(async()=>root.update(<Probe range={today} ready={true}/>));
    assert.equal(requests.length,2,'A paginated today scope is also reused');
    await act(async()=>root.unmount());
    requests.length=0;
    await act(async()=>{root=create(<Probe range={undefined} ready={false}/>)});
    assert.equal(requests.length,0,'History waits for priority bootstrap to finish');
    fail=true;
    await act(async()=>{root.update(<Probe range={undefined} ready={true}/>)});
    assert(view.error&&view.loading===false,'Failed history must not appear complete');
    fail=false;
    await act(async()=>view.retry());
    assert.equal(view.orders.length,301);assert.equal(view.error,null);
    await act(async()=>root.unmount());
    await act(async()=>{root=create(<Probe range={today}/>)});
    let pending;
    holdNext=true;
    await act(async()=>{pending=api({from:'2026-11-01',to:'2026-11-30'});});
    dataset=[{id:'fresh-scope',service_date:'2026-11-10',technician_id:'a'}];
    await act(async()=>reset());
    await act(async()=>{releaseHeld();await pending;});
    assert.deepEqual(view.orders.map(r=>r.id),['fresh-scope'],'A response from before refresh cannot overwrite the new scope');
    await act(async()=>root.unmount());
    let scopedRequest;
    const scopedLoad=async request=>{scopedRequest=request;};
    function Technician(){useOrderDateLoading(today,'service',scopedLoad,true,'technician-fixture');return null;}
    await act(async()=>{root=create(<Technician/>)});
    assert.equal(scopedRequest.technicianId,'technician-fixture','The range loader preserves technician scope');
    await act(async()=>root.unmount());
    let rejectOld;
    const load=({from})=>from?new Promise((_,reject)=>{rejectOld=reject;}):Promise.resolve();
    function Race({range}){view=useOrderDateLoading(range,'service',load);return null;}
    await act(async()=>{root=create(<Race range={today}/>)});
    await act(async()=>{root.update(<Race range={undefined}/>)});
    await act(async()=>{rejectOld(new Error('obsolete request'));});
    assert.equal(view.error,null);assert.equal(view.loading,false,'An obsolete range cannot overwrite the current state');
    await act(async()=>root.unmount());
    console.log('PASS orders: today → all history, 3 pages, undated rows, scope cache, technician constraint, bootstrap reuse (17 and 301 rows), refresh, retry, stale request');
  ` }, outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic',
  external: ['react','react-test-renderer'], logLevel: 'silent' });
  await import(pathToFileURL(outfile).href);
} finally { await fs.rm(directory,{recursive:true,force:true}); }
