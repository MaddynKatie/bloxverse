import"./modulepreload-polyfill-Ke7zwH0v.js";/* empty css             */import{A as e,K as t,L as n,O as r,P as i,a,f as o,i as s,r as c,s as l,t as u,y as d,z as f}from"./firebase-CcrBuBby.js";/* empty css             */var p=document.getElementById(`navRight`),m=document.getElementById(`profilePage`),h=new URLSearchParams(window.location.search).get(`user`);r(c,async e=>{if(!e){window.location.href=`/bloxverse/auth.html`;return}if(await s(e.uid))return;n(t(l,`bans`,e.uid),e=>{e.exists()&&e.data().banned&&(window.location.href=`/bloxverse/ban`)});let r=h||e.uid,c=r===e.uid,g=await i(t(l,`users`,r));if(!g.exists()){m.innerHTML=`<p style="text-align:center;color:#8a8c8e;padding:48px;">User not found</p>`;return}let _=g.data(),v=_.username||`Unknown`,y=_.email||``,b=_.bux||0,x=_.friends||[],S=_.followers||[],C=_.following||[],w=_.createdAt?new Date(_.createdAt).toLocaleDateString():`Unknown`,T=_.birthday||``,E=await o(r),D={developer:`<span class="role-badge" title="Developer"><i class="fa-solid fa-code"></i></span>`,admin:`<span class="role-badge" title="Admin"><i class="fa-solid fa-shield-halved"></i></span>`,mod:`<span class="role-badge" title="Moderator"><i class="fa-solid fa-gavel"></i></span>`},O=E.map(e=>D[e]||``).join(``),k=await i(t(l,`presence`,r)),A=`offline`;if(k.exists()){let e=k.data(),t=e.lastSeen?.toMillis?.()??e.lastSeen,n=Date.now()-12e4;A=t&&t<n?`offline`:e.inGame?`in-game`:`online`}let j=v.charAt(0).toUpperCase(),M=a(T)>=13,N=_.trustedFriends||[],P=[];for(let e of N.slice(0,12))try{let n=await i(t(l,`users`,e));if(n.exists()){let t=n.data();P.push({id:e,username:t.username||`Unknown`})}}catch{}let F=[];for(let e of x.slice(0,12))try{let n=await i(t(l,`users`,e));if(n.exists()){let t=n.data();F.push({id:e,username:t.username||`Unknown`})}}catch{}let I=[];for(let e of S.slice(0,12))try{let n=await i(t(l,`users`,e));if(n.exists()){let t=n.data();I.push({id:e,username:t.username||`Unknown`})}}catch{}if(m.innerHTML=`
         <a href="/bloxverse/" class="profile-back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          ${c?`Back to home`:`Back`}
        </a>

        <div class="profile-banner">
          <div class="avatar-with-status">
            <div class="profile-avatar-large">${j}</div>
            <div class="status-dot ${A}"></div>
          </div>
          <div class="profile-info">
            <h1>${v}${O}</h1>
            <div class="profile-email">${c?y:``}</div>
          </div>
        </div>

        <div class="profile-stats">
          <div class="profile-stat-card">
            <div class="stat-value">${b.toLocaleString()}</div>
            <div class="stat-label">Bux</div>
          </div>
          <div class="profile-stat-card">
            <div class="stat-value">${x.length}</div>
            <div class="stat-label">Friends</div>
          </div>
          <div class="profile-stat-card">
            <div class="stat-value">${S.length}</div>
            <div class="stat-label">Followers</div>
          </div>
          <div class="profile-stat-card">
            <div class="stat-value">${C.length}</div>
            <div class="stat-label">Following</div>
          </div>
          <div class="profile-stat-card">
            <div class="stat-value">${w}</div>
            <div class="stat-label">Joined</div>
          </div>
          ${c?`
          <div class="profile-stat-card" id="birthdayCard">
            <div class="stat-value" id="birthdayValue">${T?new Date(+T.split(`-`)[0],T.split(`-`)[1]-1,+T.split(`-`)[2]).toLocaleDateString():`—`}</div>
            <div class="stat-label">Birthday <span id="editBirthdayBtn" style="cursor:pointer;color:#5b9cfc;font-size:11px;margin-left:4px;">✏️</span></div>
          </div>`:``}
        </div>

        <div class="profile-section">
          <h2>Friends</h2>
          ${F.length===0?`<div class="empty">No friends yet</div>`:`
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

        <div class="profile-section">
          <h2>Followers</h2>
          ${I.length===0?`<div class="empty">No followers yet</div>`:`
            <div class="profile-friends-grid">
              ${I.map(e=>`
                <div class="profile-friend-item" onclick="window.location.href='/bloxverse/profile.html?user=${e.id}'">
                  <div class="friend-avatar-small">${e.username.charAt(0).toUpperCase()}</div>
                  <span class="friend-name-small">${e.username}</span>
                </div>
              `).join(``)}
            </div>
          `}
        </div>

        ${c&&M?`
        <div class="profile-section" id="trustedFriendsSection">
          <h2>Trusted Friends <span style="color:#8a8c8e;font-weight:400;font-size:12px;">(mutual, unfiltered chat)</span></h2>
          ${P.length===0?`<div class="empty">No trusted friends yet. Add trusted friends from your friends list below.</div>`:`
            <div class="profile-friends-grid">
              ${P.map(e=>`
                <div class="profile-friend-item" style="display:flex;align-items:center;gap:8px;">
                  <div class="friend-avatar-small">${e.username.charAt(0).toUpperCase()}</div>
                  <span class="friend-name-small" style="flex:1;">${e.username}</span>
                  <button class="trust-btn remove" data-id="${e.id}" data-username="${e.username}" style="background:rgba(239,68,68,0.2);color:#ef4444;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">Remove</button>
                </div>
              `).join(``)}
            </div>
          `}
          ${F.filter(e=>!N.includes(e.id)).length>0?`
            <details style="margin-top:8px;">
              <summary style="cursor:pointer;color:#5b9cfc;font-size:12px;">Add trusted friend from friends list</summary>
              <div style="margin-top:6px;">
                ${F.filter(e=>!N.includes(e.id)).map(e=>`
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

      `,c){let e=document.getElementById(`editBirthdayBtn`);e&&e.addEventListener(`click`,()=>{let e=document.getElementById(`birthdayValue`);e.innerHTML=`<input type="date" id="birthdayInput" value="`+(_.birthday||``)+`" style="background:#1a1d2e;border:1px solid rgba(124,92,252,0.3);color:#fff;border-radius:4px;padding:2px 6px;font-size:12px;width:130px;"> <button id="saveBirthdayBtn" style="background:rgba(124,92,252,0.4);color:#fff;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">Save</button>`,document.getElementById(`saveBirthdayBtn`).addEventListener(`click`,async()=>{let e=document.getElementById(`birthdayInput`).value;if(e)try{await f(t(l,`users`,r),{birthday:e},{merge:!0});let[n,i,a]=e.split(`-`);document.getElementById(`birthdayValue`).textContent=new Date(+n,i-1,+a).toLocaleDateString()}catch(e){console.error(`Error saving birthday:`,e)}})}),document.querySelectorAll(`.trust-btn.add`).forEach(e=>{e.addEventListener(`click`,async t=>{let n=e.dataset.id;e.dataset.username;try{await u(r,n),e.textContent=`Added!`,e.style.background=`rgba(34,197,94,0.4)`,e.disabled=!0}catch(e){console.error(`Error adding trusted friend:`,e)}})}),document.querySelectorAll(`.trust-btn.remove`).forEach(e=>{e.addEventListener(`click`,async t=>{let n=e.dataset.id;try{await d(r,n);let t=e.closest(`.profile-friend-item`);t&&(t.style.opacity=`0.3`),e.textContent=`Removed`,e.disabled=!0}catch(e){console.error(`Error removing trusted friend:`,e)}})})}let L=c?_:await i(t(l,`users`,e.uid)).then(e=>e.exists()?e.data():{}),R=L.bux||0,z=(L.username||`P`).charAt(0).toUpperCase();p.innerHTML=`
        <div class="user-info">
          <button class="bux-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold">B</text>
            </svg>
            <span>${R.toLocaleString()}</span>
          </button>
          <div class="avatar-dropdown">
            <div class="avatar-circle">${z}</div>
            <div class="dropdown-menu">
              <div class="dropdown-header">
                <span class="dropdown-name">${L.username||`Player`}</span>
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
      `;let B=p.querySelector(`.avatar-circle`),V=p.querySelector(`.avatar-dropdown`);B.addEventListener(`click`,e=>{e.stopPropagation(),V.classList.toggle(`open`)}),document.addEventListener(`click`,e=>{V.contains(e.target)||V.classList.remove(`open`)})}),window._logout=async()=>{await e(c),window.location.href=`/bloxverse/auth.html`};