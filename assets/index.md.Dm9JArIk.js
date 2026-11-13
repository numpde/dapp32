import{Pt as e,Q as t,Wt as n,at as r,bt as i,g as a,it as o,lt as s,n as c,ot as l,st as u,tt as d,vt as f}from"./chunks/framework.fhiXEbOi.js";import{n as p}from"./chunks/theme.B1OzlZ7v.js";var m={class:`grid two`,"aria-label":`Documentation sections`},h=[`data-section`],g=[`href`],_=c(s({__name:`HomeSections`,setup(r){return(r,s)=>(f(),o(`div`,m,[(f(!0),o(t,null,i(n(p),t=>(f(),o(`section`,{key:t.id,class:`card home-section-card`,"data-section":t.id},[d(`h2`,null,[d(`a`,{href:n(a)(t.href)},e(t.label),9,g)]),d(`p`,null,e(t.summary),1)],8,h))),128))]))}}),[[`__scopeId`,`data-v-59043033`]]),v=`<svg xmlns="http://www.w3.org/2000/svg" id="dapp32-architecture"
     viewBox="0 0 1120 470" width="1120" height="470"
     role="img" aria-labelledby="dapp32-architecture-title dapp32-architecture-desc">
  <title id="dapp32-architecture-title">How a dapp32 application works</title>
  <desc id="dapp32-architecture-desc">The generic dapp32 Viewer is central. Off-chain, an application manifest describes screens, forms and workflows, and the user interacts through a wallet. On-chain, the CAM root publishes the manifest reference and contract addresses, while business contracts provide application state and execute transactions. The viewer discovers the CAM root and reads contracts. The wallet signs and submits transactions to the business contracts.</desc>
  <style>
    #dapp32-architecture {
      --fallback-bg: #ffffff;
      --fallback-soft: #f6f7fa;
      --fallback-divider: #d8dde8;
      --fallback-text: #202736;
      --fallback-muted: #576377;
      --surface: var(--vp-c-bg, var(--fallback-bg));
      --soft: var(--vp-c-bg-soft, var(--fallback-soft));
      --divider: var(--vp-c-divider, var(--fallback-divider));
      --ink: var(--vp-c-text-1, var(--fallback-text));
      --muted: var(--vp-c-text-2, var(--fallback-muted));
      --purple: color-mix(in srgb, var(--surface) 84%, #9065cf);
      --purple-edge: color-mix(in srgb, var(--muted) 44%, #8f66d0);
      --blue: color-mix(in srgb, var(--surface) 83%, #3979ed);
      --blue-edge: var(--vp-c-brand-1, #3676e8);
      font-family: var(--vp-font-family-base, system-ui, -apple-system, "Segoe UI", sans-serif);
      text-rendering: geometricPrecision;
    }
    @media (prefers-color-scheme: dark) {
      #dapp32-architecture {
        --fallback-bg: #16171d;
        --fallback-soft: #1e2029;
        --fallback-divider: #414657;
        --fallback-text: #f2f3f7;
        --fallback-muted: #b4bdd0;
      }
    }
    #dapp32-architecture .region { fill: var(--soft); stroke: var(--divider); stroke-width: 1.5; }
    #dapp32-architecture .heading { fill: var(--muted); font-size: 18px; font-weight: 650; letter-spacing: 1.5px; }
    #dapp32-architecture .card { fill: var(--purple); stroke: var(--purple-edge); stroke-width: 1.5; }
    #dapp32-architecture .viewer { fill: var(--blue); stroke: var(--blue-edge); stroke-width: 3.5; }
    #dapp32-architecture .title { fill: var(--ink); font-weight: 690; font-size: 22px; }
    #dapp32-architecture .detail { fill: var(--muted); font-size: 17px; font-weight: 480; }
    #dapp32-architecture .viewer-title { fill: var(--ink); font-size: 33px; font-weight: 760; }
    #dapp32-architecture .viewer-detail { fill: var(--muted); font-size: 19px; font-weight: 550; }
    #dapp32-architecture .arrow { fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    #dapp32-architecture .arrow-label { fill: var(--muted); font-size: 16px; font-weight: 600; }
    #dapp32-architecture .arrow-head { fill: none; stroke: var(--muted); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    #dapp32-architecture .node-link { cursor: pointer; }
    #dapp32-architecture .node-link:hover .card,
    #dapp32-architecture .node-link:focus-visible .card {
      stroke: var(--blue-edge); stroke-width: 3;
    }
    #dapp32-architecture .node-link:hover .viewer,
    #dapp32-architecture .node-link:focus-visible .viewer { stroke-width: 5; }
    #dapp32-architecture .node-link:focus-visible { outline: none; }
  </style>
  <defs>
    <marker id="dapp32-arrow-head" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
      <path class="arrow-head" d="M 1 1 L 9 5 L 1 9"/>
    </marker>
  </defs>

  <rect class="region" x="20" y="62" width="306" height="318" rx="18"/>
  <rect class="region" x="794" y="62" width="306" height="318" rx="18"/>
  <text class="heading" x="173" y="93" text-anchor="middle">Off-chain</text>
  <text class="heading" x="947" y="93" text-anchor="middle">On-chain</text>

  <a class="node-link" href="./build/#edit" aria-label="Application manifest (CAM): learn to edit a workflow">
    <rect class="card" x="39" y="119" width="268" height="108" rx="20"/>
    <text class="title" x="173" y="155" text-anchor="middle">Application manifest</text>
    <text class="detail" x="173" y="183" text-anchor="middle">CAM · screens · forms</text>
    <text class="detail" x="173" y="207" text-anchor="middle">workflows · ABIs</text>
  </a>

  <a class="node-link" href="./start/local-wallet.html" aria-label="User and wallet: try the local wallet tutorial">
    <rect class="card" x="39" y="262" width="268" height="94" rx="20"/>
    <text class="title" x="173" y="318" text-anchor="middle">User and wallet</text>
  </a>

  <a class="node-link" href="./use/#hosted" aria-label="dapp32 Viewer: open an application">
    <rect class="viewer" x="410" y="150" width="300" height="191" rx="24"/>
    <text class="viewer-title" x="560" y="247" text-anchor="middle">dapp32 Viewer</text>
    <text class="viewer-detail" x="560" y="277" text-anchor="middle">Discover · render · interact</text>
  </a>

  <a class="node-link" href="./start/#opening-an-application" aria-label="CAM root: learn how applications are discovered">
    <rect class="card" x="813" y="119" width="268" height="108" rx="20"/>
    <text class="title" x="947" y="161" text-anchor="middle">CAM root</text>
    <text class="detail" x="947" y="187" text-anchor="middle">Manifest URI · integrity hash</text>
    <text class="detail" x="947" y="210" text-anchor="middle">contract addresses</text>
  </a>

  <a class="node-link" href="./start/#executing-an-action" aria-label="Business contracts: learn how transactions execute">
    <rect class="card" x="813" y="262" width="268" height="94" rx="20"/>
    <text class="title" x="947" y="304" text-anchor="middle">Business contracts</text>
    <text class="detail" x="947" y="331" text-anchor="middle">State · rules · transactions</text>
  </a>

  <path class="arrow" d="M 307 173 H 407" marker-end="url(#dapp32-arrow-head)"/>
  <path class="arrow" d="M 307 307 H 407" marker-end="url(#dapp32-arrow-head)"/>
  <path class="arrow" d="M 712 173 H 811" marker-end="url(#dapp32-arrow-head)"/>
  <path class="arrow" d="M 712 307 H 811" marker-end="url(#dapp32-arrow-head)"/>
  <text class="arrow-label" x="358" y="154" text-anchor="middle">Describes</text>
  <text class="arrow-label" x="358" y="288" text-anchor="middle">Interacts</text>
  <text class="arrow-label" x="761" y="154" text-anchor="middle">Discovers</text>
  <text class="arrow-label" x="761" y="288" text-anchor="middle">Reads state</text>

  <path class="arrow" d="M 173 356 V 429 H 947 V 354" marker-end="url(#dapp32-arrow-head)"/>
  <text class="arrow-label" x="560" y="416" text-anchor="middle">Signs and submits</text>
</svg>
`,y={class:`ported-guide`},b={class:`architecture-diagram`},x=[`innerHTML`],S={id:`documentation`},C=JSON.parse(`{"title":"What is dapp32?","description":"Business contracts, a CAM root, an off-chain manifest, and a standard viewer.","frontmatter":{"title":"What is dapp32?","description":"Business contracts, a CAM root, an off-chain manifest, and a standard viewer.","outline":false},"headers":[],"relativePath":"index.md","filePath":"index.md"}`),w=s({name:`index.md`,setup(e){return(e,t)=>(f(),o(`div`,null,[t[7]||=d(`h1`,{id:`what-is-dapp32`,tabindex:`-1`},[l(`What is dapp32? `),d(`a`,{class:`header-anchor`,href:`#what-is-dapp32`,"aria-label":`Permalink to “What is dapp32?”`},`​`)],-1),d(`div`,y,[t[0]||=d(`p`,null,`A typical dapp32 application has these components:`,-1),t[1]||=d(`div`,{class:`table-scroll`,role:`region`,"aria-label":`Components of a dapp32 application`,tabindex:`0`},[d(`table`,{class:`component-table`},[d(`thead`,null,[d(`tr`,null,[d(`th`,{scope:`col`},`Component`),d(`th`,{scope:`col`},`On-chain`),d(`th`,{scope:`col`},`App-specific`),d(`th`,{scope:`col`},`Responsibility`)])]),d(`tbody`,null,[d(`tr`,null,[d(`th`,{scope:`row`},`Business contracts`),d(`td`,null,`Yes`),d(`td`,null,`Yes`),d(`td`,null,`Business logic, state, permissions, and transactions`)]),d(`tr`,null,[d(`th`,{scope:`row`},`Contract Application Manifest (CAM)`),d(`td`,null,`No`),d(`td`,null,`Yes`),d(`td`,null,`Describe workflows, contract interactions, views, forms, and actions`)]),d(`tr`,null,[d(`th`,{scope:`row`},`CAM root contract`),d(`td`,null,`Yes`),d(`td`,null,`Yes`),d(`td`,null,`Point to the CAM and resolve contracts by name`)]),d(`tr`,null,[d(`th`,{scope:`row`},`Standard viewer`),d(`td`,null,`No`),d(`td`,null,`No`),d(`td`,null,`Read contract state, interpret and render the CAM, prepare transactions`)]),d(`tr`,null,[d(`th`,{scope:`row`},`UI projection (optional)`),d(`td`,null,`Yes`),d(`td`,null,`Yes`),d(`td`,null,`Assemble contract state into useful information`)])])])],-1),t[2]||=r(`<h2>Important distinctions</h2><p> The CAM is a standardized description of contract workflows that positions itself between low-level on-chain operations and custom frontends. It can be read by both autonomous agents and the standard viewer (implemented in this repo), and allows developers to build and ship faster by providing functionality without the overhead of a custom frontend. It consists of off-chain files, including: </p><ul><li><code>main.json</code>: describes workflows, routes, and contract reads and writes;</li><li><code>ui.json</code>: contains forms, screens, controls, and presentation definitions;</li><li>ABI and protocol resources: the interfaces and conventions needed to interpret those operations.</li></ul><p> The CAM root contract is a publication and discovery mechanism. It identifies the on-chain contracts by name and publishes the location and digest of the off-chain CAM. </p><p> The viewer is <strong>not</strong> specific to the application. It is a standard frontend-only application that can be self-hosted or not. </p><h2>How they fit together</h2>`,6),d(`figure`,b,[d(`div`,{class:`architecture-scroll`,role:`region`,"aria-label":`dapp32 application architecture`,tabindex:`0`,innerHTML:n(v)},null,8,x)]),t[3]||=d(`p`,null,`The business contracts remain authoritative throughout.`,-1),t[4]||=d(`p`,null,` This repository demonstrates this approach end to end with three applications: `,-1),t[5]||=d(`ul`,null,[d(`li`,null,`Pay-to-Play as a blockchain payment system with cumulative voucher collection;`),d(`li`,null,`An Escrow service;`),d(`li`,null,`A Bike NFT on-chain registration database for bicycle components.`)],-1),t[6]||=d(`h2`,null,`Where to go next`,-1),d(`section`,S,[u(_)])])]))}});export{C as __pageData,w as default};