import"./modulepreload-polyfill-Ke7zwH0v.js";/* empty css             */import{D as e,I as t,T as n,U as r,_ as i,d as a,i as o,j as s,n as c,o as l,r as u,t as d}from"./firebase-HvCPFqZQ.js";/* empty css             */var f=document.getElementById(`navRight`),p=document.getElementById(`profilePage`),m=new URLSearchParams(window.location.search).get(`user`);n(c,async e=>{if(!e){window.location.href=`/bloxverse/auth.html`;return}if(await u(e.uid))return;let n=m||e.uid,c=n===e.uid,h=await s(r(l,`users`,n));if(!h.exists()){p.innerHTML=`<p style="text-align:center;color:#8a8c8e;padding:48px;">User not found</p>`;return}let g=h.data(),_=g.username||`Unknown`,v=g.email||``,y=g.bux||0,b=g.friends||[],x=g.followers||[],S=g.following||[],C=g.createdAt?new Date(g.createdAt).toLocaleDateString():`Unknown`,w=g.birthday||``,T=await a(n),E={developer:`<span class="role-badge" title="Developer"><i class="fa-solid fa-code"></i></span>`,admin:`<span class="role-badge" title="Admin"><i class="fa-solid fa-shield-halved"></i></span>`,mod:`<span class="role-badge" title="Moderator"><i class="fa-solid fa-gavel"></i></span>`},D=T.map(e=>E[e]||``).join(``),O=await s(r(l,`presence`,n)),k=`offline`;if(O.exists()){let e=O.data(),t=e.lastSeen?.toMillis?.()??e.lastSeen,n=Date.now()-12e4;k=t&&t<n?`offline`:e.inGame?`in-game`:`online`}let A=_.charAt(0).toUpperCase(),j=o(w)>=13,M=g.trustedFriends||[],N=[];for(let e of M.slice(0,12))try{let t=await s(r(l,`users`,e));if(t.exists()){let n=t.data();N.push({id:e,username:n.username||`Unknown`})}}catch{}let P=[];for(let e of b.slice(0,12))try{let t=await s(r(l,`users`,e));if(t.exists()){let n=t.data();P.push({id:e,username:n.username||`Unknown`})}}catch{}let F=[];for(let e of x.slice(0,12))try{let t=await s(r(l,`users`,e));if(t.exists()){let n=t.data();F.push({id:e,username:n.username||`Unknown`})}}catch{}if(p.innerHTML=`
         <a href="/bloxverse/" class="profile-back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          ${c?`Back to home`:`Back`}
        </a>

        <div class="profile-banner">
          <div class="avatar-with-status">
            <div class="profile-avatar-large">${A}</div>
            <div class="status-dot ${k}"></div>
          </div>
          <div class="profile-info">
            <h1>${_}${D}</h1>
            <div class="profile-email">${c?v:``}</div>
          </div>
        </div>

        <div class="profile-stats">
          <div class="profile-stat-card">
            <div class="stat-value">${y.toLocaleString()}</div>
            <div class="stat-label">Bux</div>
          </div>
          <div class="profile-stat-card">
            <div class="stat-value">${b.length}</div>
            <div class="stat-label">Friends</div>
          </div>
          <div class="profile-stat-card">
            <div class="stat-value">${x.length}</div>
            <div class="stat-label">Followers</div>
          </div>
          <div class="profile-stat-card">
            <div class="stat-value">${S.length}</div>
            <div class="stat-label">Following</div>
          </div>
          <div class="profile-stat-card">
            <div class="stat-value">${C}</div>
            <div class="stat-label">Joined</div>
          </div>
          ${c?`
          <div class="profile-stat-card" id="birthdayCard">
            <div class="stat-value" id="birthdayValue">${w?new Date(w).toLocaleDateString():`—`}</div>
            <div class="stat-label">Birthday <span id="editBirthdayBtn" style="cursor:pointer;color:#5b9cfc;font-size:11px;margin-left:4px;">✏️</span></div>
          </div>`:``}
        </div>

        <div class="profile-section">
          <h2>Friends</h2>
          ${P.length===0?`<div class="empty">No friends yet</div>`:`
            <div class="profile-friends-grid">
              ${P.map(e=>`
                <div class="profile-friend-item" onclick="window.location.href='/bloxverse/profile.html?user=${e.id}'">
                  <div class="friend-avatar-small">${e.username.charAt(0).toUpperCase()}</div>
                  <span class="friend-name-small">${e.username}</span>
                </div>
              `).join(``)}
            </div>
          `}
        </div>

        <div class="profile-section">
          <h2>Followers</h2>
          ${F.length===0?`<div class="empty">No followers yet</div>`:`
            <div class="profile-friends-grid">
              ${F.map(e=>`
                <div class="profile-friend-item" onclick="window.location.href='/bloxverse/profile.html?user=${e.id}'">
                  <div class="friend-avatar-small">${e.username.charAt(0).toUpperCase()}</div>
                  <span class="friend-name-small">${e.username}</span>
                </div>
              `).join(``)}
            </div>
          `}
        </div>

        ${c&&j?`
        <div class="profile-section" id="trustedFriendsSection">
          <h2>Trusted Friends <span style="color:#8a8c8e;font-weight:400;font-size:12px;">(mutual, unfiltered chat)</span></h2>
          ${N.length===0?`<div class="empty">No trusted friends yet. Add trusted friends from your friends list below.</div>`:`
            <div class="profile-friends-grid">
              ${N.map(e=>`
                <div class="profile-friend-item" style="display:flex;align-items:center;gap:8px;">
                  <div class="friend-avatar-small">${e.username.charAt(0).toUpperCase()}</div>
                  <span class="friend-name-small" style="flex:1;">${e.username}</span>
                  <button class="trust-btn remove" data-id="${e.id}" data-username="${e.username}" style="background:rgba(239,68,68,0.2);color:#ef4444;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">Remove</button>
                </div>
              `).join(``)}
            </div>
          `}
          ${P.filter(e=>!M.includes(e.id)).length>0?`
            <details style="margin-top:8px;">
              <summary style="cursor:pointer;color:#5b9cfc;font-size:12px;">Add trusted friend from friends list</summary>
              <div style="margin-top:6px;">
                ${P.filter(e=>!M.includes(e.id)).map(e=>`
                  <div class="profile-friend-item" style="display:flex;align-items:center;gap:8px;">
                    <div class="friend-avatar-small">${e.username.charAt(0).toUpperCase()}</div>
                    <span class="friend-name-small" style="flex:1;">${e.username}</span>
                    <button class="trust-btn add" data-id="${e.id}" data-username="${e.username}" style="background:rgba(34,197,94,0.2);color:#22c55e;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">Trust</button>
                  </div>
                `).join(``)}
              </div>
            </details>
          `:``}
        </div>
        `:``}

      `,c){let e=document.getElementById(`editBirthdayBtn`);e&&e.addEventListener(`click`,()=>{let e=document.getElementById(`birthdayValue`);e.innerHTML=`<input type="date" id="birthdayInput" value="`+(g.birthday||``)+`" style="background:#1a1d2e;border:1px solid rgba(124,92,252,0.3);color:#fff;border-radius:4px;padding:2px 6px;font-size:12px;width:130px;"> <button id="saveBirthdayBtn" style="background:rgba(124,92,252,0.4);color:#fff;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">Save</button>`,document.getElementById(`saveBirthdayBtn`).addEventListener(`click`,async()=>{let e=document.getElementById(`birthdayInput`).value;if(e)try{await t(r(l,`users`,n),{birthday:e},{merge:!0}),document.getElementById(`birthdayValue`).textContent=new Date(e).toLocaleDateString()}catch(e){console.error(`Error saving birthday:`,e)}})}),document.querySelectorAll(`.trust-btn.add`).forEach(e=>{e.addEventListener(`click`,async t=>{let r=e.dataset.id;e.dataset.username;try{await d(n,r),e.textContent=`Added!`,e.style.background=`rgba(34,197,94,0.4)`,e.disabled=!0}catch(e){console.error(`Error adding trusted friend:`,e)}})}),document.querySelectorAll(`.trust-btn.remove`).forEach(e=>{e.addEventListener(`click`,async t=>{let r=e.dataset.id;try{await i(n,r);let t=e.closest(`.profile-friend-item`);t&&(t.style.opacity=`0.3`),e.textContent=`Removed`,e.disabled=!0}catch(e){console.error(`Error removing trusted friend:`,e)}})})}let I=c?g:await s(r(l,`users`,e.uid)).then(e=>e.exists()?e.data():{}),L=I.bux||0,R=(I.username||`P`).charAt(0).toUpperCase();f.innerHTML=`
        <div class="user-info">
          <button class="bux-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold">B</text>
            </svg>
            <span>${L.toLocaleString()}</span>
          </button>
          <div class="avatar-dropdown">
            <div class="avatar-circle">${R}</div>
            <div class="dropdown-menu">
              <div class="dropdown-header">
                <span class="dropdown-name">${I.username||`Player`}</span>
                <span class="dropdown-email">${e.email}</span>
              </div>
              <button class="dropdown-item" onclick="window.location.href='/bloxverse/profile.html'">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                Profile
              </button>
              <button class="dropdown-item" onclick="window.location.href='/bloxverse/avatar.html'">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                Avatar
              </button>
              <button class="dropdown-item" onclick="window._logout()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Log Out
              </button>
            </div>
          </div>
        </div>
      `;let z=f.querySelector(`.avatar-circle`),B=f.querySelector(`.avatar-dropdown`);z.addEventListener(`click`,e=>{e.stopPropagation(),B.classList.toggle(`open`)}),document.addEventListener(`click`,e=>{B.contains(e.target)||B.classList.remove(`open`)})}),window._logout=async()=>{await e(c),window.location.href=`/bloxverse/auth.html`};