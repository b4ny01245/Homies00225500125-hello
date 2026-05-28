/* ======================== */
/* MY HOMIES - APP (Firebase) */
/* Vanilla JavaScript ES6+   */
/* ======================== */

import { initializeApp }   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    getFirestore, collection, doc, setDoc, getDoc, updateDoc, deleteDoc,
    onSnapshot, addDoc, serverTimestamp, query, orderBy, where,
    getDocs, writeBatch, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ========================
// FIREBASE CONFIG
// ========================
const firebaseConfig = {
    apiKey:            "AIzaSyDVFcsya3GrA75tzTdEk7sQoq69Jt0ee8M",
    authDomain:        "my-homies.firebaseapp.com",
    projectId:         "my-homies",
    storageBucket:     "my-homies.firebasestorage.app",
    messagingSenderId: "1072152282603",
    appId:             "1:1072152282603:web:29d91ce0b6e75ce75cc5ae",
    measurementId:     "G-0CB0Y4GVDR"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);
const storage     = getStorage(firebaseApp);

// ========================
// MISSION CONFIG
// ========================
const MISSIONS = {
    morning:   { label: 'Morning Update',   start: 5,  end: 12, fine: 50 },
    breakfast: { label: 'Breakfast Update', start: 5,  end: 12, fine: 50 },
    bedtime:   { label: 'Bedtime Update',   start: 18, end: 24, fine: 50 }
};

const MORNING_KEYWORDS  = ['good morning','gm','morning','magandang umaga','rise','grabe','hello','hi everyone','kumusta','rise and shine','wake up','bumangon'];
const BEDTIME_KEYWORDS  = ['good night','goodnight','gn','gabi na','matulog na','sleep','night everyone','night fam','tulog na','good nyt','goodnyt'];

// ========================
// APP STATE
// ========================
const AppState = {
    currentUser:         null,
    isAuthenticated:     false,
    users:               [],
    messages:            [],
    totalFund:           0,
    menuOpen:            false,
    currentPage:         'chat',
    todayMissions:       { morning: false, breakfast: false, bedtime: false },
    replyingTo:          null,   // { id, userName, text } — active reply target
    unsubscribeMessages: null,
    unsubscribeUsers:    null,
    missionTimers:       []      // holds setInterval IDs for auto-forfeit
};

// ========================
// DOM ELEMENTS
// ========================
const authScreen       = document.getElementById('authScreen');
const mainScreen       = document.getElementById('mainScreen');
const googleSignInBtn  = document.getElementById('googleSignInBtn');
const menuBtn          = document.getElementById('menuBtn');
const menuOverlay      = document.getElementById('menuOverlay');
const sideMenu         = document.getElementById('sideMenu');
const profileMenuBtn   = document.getElementById('profileMenuBtn');
const settingsMenuBtn  = document.getElementById('settingsMenuBtn');
const aboutMenuBtn     = document.getElementById('aboutMenuBtn');
const signOutMenuBtn   = document.getElementById('signOutMenuBtn');
const navBtns          = document.querySelectorAll('.nav-btn');
const chatFeed         = document.getElementById('chatFeed');
const messageInput     = document.getElementById('messageInput');
const sendBtn          = document.getElementById('sendBtn');
const storiesContainer = document.getElementById('storiesContainer');
const streaksTable     = document.getElementById('streaksTable');
const fundAmount       = document.getElementById('fundAmount');
const modalOverlay     = document.getElementById('modalOverlay');
const settingsModal    = document.getElementById('settingsModal');
const aboutModal       = document.getElementById('aboutModal');

// ========================
// INIT
// ========================
document.addEventListener('DOMContentLoaded', () => {
    console.log('🏠 My Homies App Loading...');
    initializeEventListeners();
});

// ========================
// AUTH
// ========================
getRedirectResult(auth).catch(err => {
    if (err && err.code !== 'auth/cancelled-popup-request')
        console.error('❌ Redirect error:', err.message);
});

googleSignInBtn.addEventListener('click', async () => {
    try { await signInWithRedirect(auth, new GoogleAuthProvider()); }
    catch (err) { alert('Login failed: ' + err.message); }
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userRef  = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            await setDoc(userRef, {
                name:            user.displayName || 'Homie',
                avatar:          user.photoURL    || '👤',
                avatarIsUrl:     !!user.photoURL,
                currentStreak:   0,
                longestStreak:   0,
                owedFines:       0,
                isPerfect:       false,
                lastMissionDate: null,
                totalFinesEver:  0,
                payoutVote:      false
            });
        }

        const snap = await getDoc(userRef);
        AppState.currentUser     = { id: user.uid, ...snap.data() };
        AppState.isAuthenticated = true;

        await runDailyMissionCheck();
        await loadTodayMissions();

        authScreen.classList.remove('active');
        mainScreen.classList.add('active');

        updateUI();
        listenToUsers();
        listenToMessages();
        renderMissionsPage();
        renderProfilePage();
        startMissionForfeits();      // ← auto-forfeit timers

        console.log('✅ Logged in as:', AppState.currentUser.name);
    } else {
        AppState.missionTimers.forEach(clearInterval);
        AppState.missionTimers = [];
        if (AppState.unsubscribeMessages) AppState.unsubscribeMessages();
        if (AppState.unsubscribeUsers)    AppState.unsubscribeUsers();
        Object.assign(AppState, {
            isAuthenticated: false, currentUser: null,
            users: [], messages: [], replyingTo: null
        });
        authScreen.classList.add('active');
        mainScreen.classList.remove('active');
    }
});

function logout() { signOut(auth).catch(console.error); }

// ========================
// DATE / TIME HELPERS (Philippine Time)
// ========================
function getTodayString() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}
function getYesterdayString() {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}
function getCurrentHourPH() {
    return parseInt(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }));
}
function getCurrentMinutePH() {
    return parseInt(new Date().toLocaleString('en-US', { minute: 'numeric', timeZone: 'Asia/Manila' }));
}
// Returns ms until a given PH hour:minute (today)
function msUntilPH(hour, minute = 0) {
    const now = new Date();
    const ph  = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    ph.setHours(hour, minute, 0, 0);
    return ph - now;
}

// ========================
// DAILY MISSION CHECK
// Runs on login — processes yesterday's missed missions
// ========================
async function runDailyMissionCheck() {
    const uid      = AppState.currentUser.id;
    const today    = getTodayString();
    const userData = AppState.currentUser;
    if (userData.lastCheckedDate === today) return;

    const yesterdayRef  = doc(db, 'missions', uid, 'completions', getYesterdayString());
    const yesterdaySnap = await getDoc(yesterdayRef);
    const userRef       = doc(db, 'users', uid);

    let finesAdded   = 0;
    let streakBroken = false;

    if (yesterdaySnap.exists()) {
        const d = yesterdaySnap.data();
        if (!d.morning)   { finesAdded += 50; }
        if (!d.breakfast) { finesAdded += 50; }
        if (!d.bedtime)   { finesAdded += 50; }
        if (!d.morning && !d.breakfast && !d.bedtime) streakBroken = true;
    } else if (userData.lastMissionDate !== null) {
        finesAdded   = 150;
        streakBroken = true;
    }

    const newStreak    = streakBroken ? 0 : (userData.currentStreak || 0);
    const newOwedFines = (userData.owedFines || 0) + finesAdded;

    await updateDoc(userRef, {
        owedFines:       newOwedFines,
        totalFinesEver:  increment(finesAdded),
        currentStreak:   newStreak,
        isPerfect:       newOwedFines === 0,
        lastCheckedDate: today
    });

    AppState.currentUser = { ...AppState.currentUser,
        owedFines: newOwedFines, currentStreak: newStreak,
        isPerfect: newOwedFines === 0, lastCheckedDate: today
    };

    if (finesAdded > 0) showToast(`💸 ₱${finesAdded} fine added for yesterday's missed missions`, '#ff6b6b');
}

// ========================
// LOAD TODAY'S MISSIONS
// ========================
async function loadTodayMissions() {
    const today   = getTodayString();
    const uid     = AppState.currentUser.id;
    const ref     = doc(db, 'missions', uid, 'completions', today);
    const snap    = await getDoc(ref);

    if (snap.exists()) {
        const d = snap.data();
        AppState.todayMissions = {
            morning:   d.morning   || false,
            breakfast: d.breakfast || false,
            bedtime:   d.bedtime   || false
        };
    } else {
        await setDoc(ref, { morning: false, breakfast: false, bedtime: false });
        AppState.todayMissions = { morning: false, breakfast: false, bedtime: false };
    }
}

// ========================
// AUTO-FORFEIT TIMERS
// At exactly 12:00 PM — forfeit morning & breakfast if not done.
// At exactly midnight (next day check handled by dailyCheck on next login).
// ========================
function startMissionForfeits() {
    // Clear any existing timers
    AppState.missionTimers.forEach(clearTimeout);
    AppState.missionTimers = [];

    const msMorning = msUntilPH(12, 0);   // 12:00 PM PH = end of morning window
    const msBedtime = msUntilPH(0,  0);   // midnight = end of bedtime window (next calendar day)

    // Morning forfeit at noon
    if (msMorning > 0) {
        const t1 = setTimeout(async () => {
            await forfeitMission('morning',   '🌅 Morning mission window closed! ₱50 fine added.');
            await forfeitMission('breakfast', '☕ Breakfast mission window closed! ₱50 fine added.');
        }, msMorning);
        AppState.missionTimers.push(t1);
    }

    // Bedtime forfeit at midnight (only schedule if bedtime not yet done)
    const msBedtimeWindow = msUntilPH(24, 0);  // use 24:00 as midnight of current day
    const msToMidnight = msBedtimeWindow > 0 ? msBedtimeWindow : msUntilPH(0, 0) + 86400000;
    const t2 = setTimeout(async () => {
        await forfeitMission('bedtime', '💤 Bedtime mission window closed! ₱50 fine added.');
        // Also re-run daily check logic right at midnight
        AppState.currentUser.lastCheckedDate = null;
        await runDailyMissionCheck();
    }, msToMidnight);
    AppState.missionTimers.push(t2);

    console.log(`⏰ Morning forfeit in ${Math.round(msMorning/60000)}m`);
}

// Applies a fine immediately to the current user for a missed mission
async function forfeitMission(missionKey, toastMsg) {
    if (AppState.todayMissions[missionKey]) return; // already done — no forfeit

    const uid     = AppState.currentUser.id;
    const userRef = doc(db, 'users', uid);

    const newOwedFines = (AppState.currentUser.owedFines || 0) + 50;
    await updateDoc(userRef, {
        owedFines:      newOwedFines,
        totalFinesEver: increment(50),
        isPerfect:      false
    });

    AppState.currentUser.owedFines = newOwedFines;
    AppState.currentUser.isPerfect = false;

    showToast(toastMsg, '#ff6b6b');
    if (AppState.currentPage === 'missions') renderMissionsPage();
    if (AppState.currentPage === 'ledger')   renderLedgerPage();
}

// ========================
// COMPLETE A MISSION
// ========================
async function completeMission(missionKey) {
    if (AppState.todayMissions[missionKey]) return;

    const today    = getTodayString();
    const uid      = AppState.currentUser.id;
    const todayRef = doc(db, 'missions', uid, 'completions', today);
    const userRef  = doc(db, 'users', uid);

    AppState.todayMissions[missionKey] = true;
    await updateDoc(todayRef, { [missionKey]: true });

    const allDone = AppState.todayMissions.morning &&
                    AppState.todayMissions.breakfast &&
                    AppState.todayMissions.bedtime;

    if (allDone) {
        const newStreak  = (AppState.currentUser.currentStreak || 0) + 1;
        const newLongest = Math.max(newStreak, AppState.currentUser.longestStreak || 0);
        await updateDoc(userRef, {
            currentStreak:   newStreak,
            longestStreak:   newLongest,
            lastMissionDate: today,
            isPerfect:       AppState.currentUser.owedFines === 0
        });
        AppState.currentUser.currentStreak = newStreak;
        AppState.currentUser.longestStreak = newLongest;
        showToast(`🔥 All missions done! ${newStreak} day streak!`, 'linear-gradient(135deg,#ff6b6b,#ffd93d)');
    } else {
        showToast(`✅ ${MISSIONS[missionKey].label} completed!`, '#51cf66');
    }

    if (AppState.currentPage === 'missions') renderMissionsPage();
    renderProfilePage();
}

// ========================
// MISSION DETECTION FROM CHAT
// ========================
function detectMissionFromMessage(text) {
    const hour      = getCurrentHourPH();
    const lower     = text.toLowerCase();

    if (!AppState.todayMissions.morning &&
        hour >= MISSIONS.morning.start && hour < MISSIONS.morning.end) {
        if (MORNING_KEYWORDS.some(kw => lower.includes(kw))) completeMission('morning');
    }
    if (!AppState.todayMissions.bedtime &&
        hour >= MISSIONS.bedtime.start && hour < MISSIONS.bedtime.end) {
        if (BEDTIME_KEYWORDS.some(kw => lower.includes(kw))) completeMission('bedtime');
    }
}

async function completeBreakfastMission() {
    const hour = getCurrentHourPH();
    if (hour >= MISSIONS.breakfast.start && hour < MISSIONS.breakfast.end) {
        await completeMission('breakfast');
        return true;
    }
    showToast('📷 Breakfast mission is only available 5:00 AM – 11:59 AM!', '#ff6b6b');
    return false;
}

// ========================
// PAY OUT — ALL USERS MUST VOTE
// Stored in /payout/current  { votes: { uid: true }, total: N }
// When all registered users have voted → reset owedFines to 0 for all
// ========================
async function handlePayoutVote() {
    const uid        = AppState.currentUser.id;
    const payoutRef  = doc(db, 'payout', 'current');
    const payoutSnap = await getDoc(payoutRef);

    const totalUsers = AppState.users.length;
    if (totalUsers === 0) return;

    let votes = {};
    if (payoutSnap.exists()) {
        votes = payoutSnap.data().votes || {};
    }

    if (votes[uid]) {
        showToast('⏳ You already voted! Waiting for others…', '#4ecdc4');
        return;
    }

    votes[uid] = true;
    const voteCount = Object.keys(votes).length;

    await setDoc(payoutRef, { votes, updatedAt: serverTimestamp() });

    showToast(`👍 Your vote counted! ${voteCount}/${totalUsers} agreed`, '#4ecdc4');

    if (voteCount >= totalUsers) {
        // All voted — reset all owedFines and clear vote doc
        const batch = writeBatch(db);
        AppState.users.forEach(u => {
            batch.update(doc(db, 'users', u.id), { owedFines: 0, isPerfect: true });
        });
        batch.delete(payoutRef);
        await batch.commit();

        // Post a system message in chat
        await addDoc(collection(db, 'messages'), {
            userId:    'system',
            userName:  'My Homies',
            avatar:    '🏠',
            text:      `🎉 Fund paid out! Everyone's fines reset to ₱0. New round started!`,
            timestamp: serverTimestamp(),
            isSystem:  true
        });

        showToast('🎉 Fund paid out! All fines reset!', 'linear-gradient(135deg,#4ecdc4,#ffd93d)');
    }
}

// Listen to payout votes in real-time so ledger button updates live
function listenToPayoutVotes() {
    const payoutRef = doc(db, 'payout', 'current');
    onSnapshot(payoutRef, (snap) => {
        const totalUsers = AppState.users.length;
        const votes      = snap.exists() ? Object.keys(snap.data().votes || {}).length : 0;
        const payoutBtn  = document.querySelector('.btn-payout');
        if (payoutBtn) {
            const myVote = snap.exists() && snap.data().votes?.[AppState.currentUser?.id];
            payoutBtn.textContent = myVote
                ? `✅ Voted (${votes}/${totalUsers})`
                : `👥 Pay Out (${votes}/${totalUsers})`;
            payoutBtn.style.opacity = myVote ? '0.65' : '1';
        }
    });
}

// ========================
// PROFILE PICTURE UPLOAD (Firebase Storage)
// ========================
async function uploadProfilePicture(file) {
    if (!AppState.currentUser) return;
    const uid     = AppState.currentUser.id;
    const ext     = file.name.split('.').pop();
    const sRef    = storageRef(storage, `avatars/${uid}.${ext}`);

    showToast('⏳ Uploading picture…', '#4ecdc4');

    try {
        const snapshot = await uploadBytes(sRef, file);
        const url      = await getDownloadURL(snapshot.ref);

        // Save URL to Firestore
        const userRef = doc(db, 'users', uid);
        await updateDoc(userRef, { avatar: url, avatarIsUrl: true });

        AppState.currentUser.avatar      = url;
        AppState.currentUser.avatarIsUrl = true;

        updateProfilePicDisplay(url);
        updateMenuProfile();
        showToast('✅ Profile picture updated!', '#51cf66');
    } catch (err) {
        console.error('Upload error:', err);
        showToast('❌ Upload failed: ' + err.message, '#ff6b6b');
    }
}

// Render profile pic — handles both URL images and emoji
function updateProfilePicDisplay(avatarVal) {
    const isUrl  = avatarVal && (avatarVal.startsWith('http') || avatarVal.startsWith('data:'));
    const pic    = document.getElementById('profilePicPlaceholder');
    if (!pic) return;
    if (isUrl) {
        pic.innerHTML = `<img src="${avatarVal}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
    } else {
        pic.textContent = avatarVal || '👤';
    }
}

// ========================
// REPLY TO MESSAGE
// ========================
function setReplyTarget(msg) {
    AppState.replyingTo = msg;
    let replyBar = document.getElementById('replyBar');
    if (!replyBar) {
        replyBar = document.createElement('div');
        replyBar.id = 'replyBar';
        replyBar.style.cssText = `
            display:flex; align-items:center; gap:8px;
            background:#2d2d2d; border-left:3px solid #4ecdc4;
            padding:8px 12px; font-size:0.8rem; color:#b0b0b0;
            flex-shrink:0;
        `;
        const chatInputArea = document.querySelector('.chat-input-area');
        chatInputArea.parentNode.insertBefore(replyBar, chatInputArea);
    }
    replyBar.innerHTML = `
        <span style="flex:1">
            <strong style="color:#4ecdc4">${escapeHtml(msg.userName)}</strong>:
            ${escapeHtml(msg.text.substring(0, 60))}${msg.text.length > 60 ? '…' : ''}
        </span>
        <button id="cancelReply" style="background:none;border:none;color:#ff6b6b;font-size:1.1rem;cursor:pointer;">✕</button>
    `;
    document.getElementById('cancelReply').addEventListener('click', clearReply);
    messageInput.focus();
}

function clearReply() {
    AppState.replyingTo = null;
    const bar = document.getElementById('replyBar');
    if (bar) bar.remove();
}

// ========================
// REAL-TIME LISTENERS
// ========================
function listenToMessages() {
    if (AppState.unsubscribeMessages) AppState.unsubscribeMessages();
    const q = query(collection(db, 'messages'), orderBy('timestamp', 'asc'));
    AppState.unsubscribeMessages = onSnapshot(q, (snap) => {
        AppState.messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderChatFeed();
    });
}

function listenToUsers() {
    if (AppState.unsubscribeUsers) AppState.unsubscribeUsers();
    AppState.unsubscribeUsers = onSnapshot(collection(db, 'users'), (snap) => {
        AppState.users     = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        AppState.totalFund = AppState.users.reduce((s, u) => s + (u.owedFines || 0), 0);
        renderStories();
        renderLedgerPage();
    });
}

// ========================
// EVENT LISTENERS
// ========================
function initializeEventListeners() {
    menuBtn.addEventListener('click', toggleMenu);
    menuOverlay.addEventListener('click', closeMenu);
    sideMenu.addEventListener('click', e => { if (e.target === sideMenu) closeMenu(); });

    profileMenuBtn.addEventListener('click',  () => { closeMenu(); switchPage('profile'); });
    settingsMenuBtn.addEventListener('click', () => { closeMenu(); openModal(settingsModal); });
    aboutMenuBtn.addEventListener('click',    () => { closeMenu(); openModal(aboutModal); });
    signOutMenuBtn.addEventListener('click',  () => { closeMenu(); logout(); });

    navBtns.forEach(btn => btn.addEventListener('click', () => switchPage(btn.dataset.page)));

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    // 📷 Photo button — breakfast mission + send a photo message
    const photoBtn = document.getElementById('photoBtn');
    if (photoBtn) {
        // Create hidden file input for photo
        const photoInput = document.createElement('input');
        photoInput.type   = 'file';
        photoInput.accept = 'image/*';
        photoInput.style.display = 'none';
        document.body.appendChild(photoInput);

        photoBtn.addEventListener('click', () => photoInput.click());
        photoInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const ok = await completeBreakfastMission();
            if (ok) {
                // Upload to storage and send as message
                const uid   = AppState.currentUser.id;
                const sRef  = storageRef(storage, `chat-photos/${uid}-${Date.now()}`);
                showToast('⏳ Sending photo…', '#4ecdc4');
                try {
                    const snap = await uploadBytes(sRef, file);
                    const url  = await getDownloadURL(snap.ref);
                    await addDoc(collection(db, 'messages'), {
                        userId:    uid,
                        userName:  AppState.currentUser.name,
                        avatar:    AppState.currentUser.avatar || '👤',
                        avatarIsUrl: AppState.currentUser.avatarIsUrl || false,
                        text:      '📸 Breakfast photo!',
                        photoUrl:  url,
                        timestamp: serverTimestamp()
                    });
                    detectMissionFromMessage('📸 Breakfast photo!');
                } catch(err) {
                    showToast('❌ Photo failed: ' + err.message, '#ff6b6b');
                }
            }
            photoInput.value = '';
        });
    }

    // Profile picture upload
    const picUpload = document.getElementById('profilePictureUpload');
    const picInput  = document.getElementById('profilePictureInput');
    const nameInput = document.getElementById('profileNameInput');

    if (picUpload && picInput) {
        picUpload.addEventListener('click', () => picInput.click());
        picInput.addEventListener('change', async e => {
            const file = e.target.files[0];
            if (file) await uploadProfilePicture(file);
            picInput.value = '';
        });
    }

    if (nameInput) {
        nameInput.addEventListener('change', async e => {
            const newName = e.target.value.trim();
            if (!newName) return;
            AppState.currentUser.name = newName;
            await setDoc(doc(db, 'users', AppState.currentUser.id), { name: newName }, { merge: true });
            updateMenuProfile();
        });
    }

    document.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', closeAllModals));
    modalOverlay.addEventListener('click', closeAllModals);

    const clearBtn = document.getElementById('clearDataBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (confirm('Clear local settings?')) { localStorage.clear(); alert('Cleared.'); }
        });
    }
}

// ========================
// MENU
// ========================
function toggleMenu() { AppState.menuOpen ? closeMenu() : openMenu(); }
function openMenu()  { sideMenu.classList.add('active');    menuOverlay.classList.add('active');    AppState.menuOpen = true;  }
function closeMenu() { sideMenu.classList.remove('active'); menuOverlay.classList.remove('active'); AppState.menuOpen = false; }

// ========================
// PAGE SWITCHING
// ========================
function switchPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(name + 'Page');
    if (!page) return;
    page.classList.add('active');
    AppState.currentPage = name;
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.page === name));
    if (name === 'chat')     renderChatPage();
    if (name === 'profile')  renderProfilePage();
    if (name === 'missions') renderMissionsPage();
    if (name === 'ledger')   { renderLedgerPage(); listenToPayoutVotes(); }
}

// ========================
// PROFILE PAGE
// ========================
function renderProfilePage() {
    if (!AppState.currentUser) return;
    const nameEl   = document.getElementById('profileNameInput');
    const streakEl = document.getElementById('profileStreakValue');
    if (nameEl)   nameEl.value         = AppState.currentUser.name || '';
    if (streakEl) streakEl.textContent = AppState.currentUser.currentStreak || 0;
    updateProfilePicDisplay(AppState.currentUser.avatar);
}

function updateProfileDisplay() { updateProfilePicDisplay(AppState.currentUser?.avatar); }

// ========================
// CHAT PAGE
// ========================
function renderChatPage() { renderStories(); renderChatFeed(); }

function renderStories() {
    if (!storiesContainer) return;
    storiesContainer.innerHTML = '';
    AppState.users.forEach(user => {
        const el = document.createElement('div');
        el.className = 'story-avatar';
        const avatarHtml = (user.avatarIsUrl && user.avatar?.startsWith('http'))
            ? `<img src="${user.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
            : (user.avatar || '👤');
        el.innerHTML = `
            <div class="story-ring"><div class="story-image">${avatarHtml}</div></div>
            <div class="story-name">${(user.name || 'Homie').split(' ')[0]}</div>
        `;
        storiesContainer.appendChild(el);
    });
}

function renderChatFeed() {
    if (!chatFeed || !AppState.currentUser) return;

    // Remember scroll position — only auto-scroll if near bottom
    const wasAtBottom = chatFeed.scrollHeight - chatFeed.scrollTop - chatFeed.clientHeight < 80;
    chatFeed.innerHTML = '';

    AppState.messages.forEach(msg => {
        const isOwn    = msg.userId === AppState.currentUser.id;
        const isSystem = msg.isSystem;
        const el       = document.createElement('div');

        if (isSystem) {
            el.className = 'message system-message';
            el.innerHTML = `<div class="message-bubble system-bubble">${escapeHtml(msg.text)}</div>`;
            chatFeed.appendChild(el);
            return;
        }

        el.className = `message ${isOwn ? 'sent' : 'received'}`;

        const ts      = msg.timestamp?.toDate ? msg.timestamp.toDate() : msg.timestamp;
        const timeStr = ts ? formatTime(ts) : '';

        const avatarHtml = (msg.avatarIsUrl && msg.avatar?.startsWith('http'))
            ? `<img src="${msg.avatar}" style="width:36px;height:36px;object-fit:cover;border-radius:50%;">`
            : (msg.avatar || '👤');

        // Reply quote block
        const replyHtml = msg.replyTo ? `
            <div style="
                background:rgba(255,255,255,0.07); border-left:3px solid #4ecdc4;
                padding:4px 8px; margin-bottom:4px; border-radius:4px;
                font-size:0.75rem; color:#b0b0b0; cursor:pointer;
            " onclick="scrollToMessage('${msg.replyTo.id}')">
                <strong style="color:#4ecdc4">${escapeHtml(msg.replyTo.userName)}</strong>:
                ${escapeHtml((msg.replyTo.text || '').substring(0, 60))}${(msg.replyTo.text||'').length > 60 ? '…' : ''}
            </div>
        ` : '';

        const photoHtml = msg.photoUrl
            ? `<img src="${msg.photoUrl}" style="max-width:200px;border-radius:8px;margin-top:4px;display:block;" />`
            : '';

        el.dataset.msgId = msg.id;
        el.innerHTML = `
            ${!isOwn ? `<div class="message-avatar" style="font-size:1.4rem">${avatarHtml}</div>` : ''}
            <div style="max-width:75%">
                ${!isOwn ? `<div class="message-sender">${escapeHtml(msg.userName || '')}</div>` : ''}
                <div class="message-bubble" style="position:relative">
                    ${replyHtml}
                    ${escapeHtml(msg.text)}
                    ${photoHtml}
                </div>
                <div class="message-time" style="display:flex;gap:8px;align-items:center">
                    ${timeStr}
                    <button class="reply-btn" data-id="${msg.id}" style="
                        background:none;border:none;color:#808080;font-size:0.7rem;
                        cursor:pointer;padding:0;
                    ">↩ reply</button>
                </div>
            </div>
        `;

        // Reply button click
        el.querySelector('.reply-btn').addEventListener('click', () => {
            setReplyTarget({ id: msg.id, userName: msg.userName, text: msg.text });
        });

        chatFeed.appendChild(el);
    });

    if (wasAtBottom) chatFeed.scrollTop = chatFeed.scrollHeight;
}

// Scroll to a specific message (for reply jumps)
function scrollToMessage(msgId) {
    const el = chatFeed.querySelector(`[data-msg-id="${msgId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !AppState.currentUser) return;
    messageInput.value = '';

    const msgData = {
        userId:     AppState.currentUser.id,
        userName:   AppState.currentUser.name,
        avatar:     AppState.currentUser.avatar || '👤',
        avatarIsUrl: AppState.currentUser.avatarIsUrl || false,
        text:       text,
        timestamp:  serverTimestamp()
    };

    if (AppState.replyingTo) {
        msgData.replyTo = {
            id:       AppState.replyingTo.id,
            userName: AppState.replyingTo.userName,
            text:     AppState.replyingTo.text
        };
        clearReply();
    }

    try {
        await addDoc(collection(db, 'messages'), msgData);
        detectMissionFromMessage(text);
    } catch (err) {
        console.error('❌ Send failed:', err);
        messageInput.value = text;
    }
}

// ========================
// MISSIONS PAGE
// ========================
function renderMissionsPage() {
    const container = document.querySelector('.missions-container');
    if (!container) return;

    const hour      = getCurrentHourPH();
    const completed = Object.values(AppState.todayMissions).filter(Boolean).length;

    const cards = [
        { key: 'morning',   icon: '🌅', title: 'Morning Update',   time: '05:00 AM – 11:59 AM',
          desc: 'Send a message with "good morning" or similar keywords. Keep your streak alive!',
          active: hour >= 5 && hour < 12, forfeited: hour >= 12 },
        { key: 'breakfast', icon: '☕', title: 'Breakfast Update', time: '05:00 AM – 11:59 AM',
          desc: 'Tap 📷 to send a breakfast photo. Your daily proof of life for the group.',
          active: hour >= 5 && hour < 12, forfeited: hour >= 12 },
        { key: 'bedtime',   icon: '💤', title: 'Bedtime Update',   time: '06:00 PM – 11:59 PM',
          desc: 'Say goodnight to the group. The night never falls alone.',
          active: hour >= 18 && hour < 24, forfeited: hour >= 24 || hour < 0 }
    ];

    container.innerHTML = `
        ${cards.map(m => {
            const done = AppState.todayMissions[m.key];
            let statusIcon, statusLabel, border;
            if (done)           { statusIcon = '✅'; statusLabel = 'Done!';       border = '#51cf66'; }
            else if (m.forfeited){ statusIcon = '❌'; statusLabel = 'Forfeited';   border = '#ff6b6b'; }
            else if (m.active)   { statusIcon = '⏳'; statusLabel = 'Active now';  border = '#ffd93d'; }
            else                 { statusIcon = '🔒'; statusLabel = 'Not yet';     border = '#404040'; }

            return `
                <div class="mission-card" style="
                    border-left: 4px solid ${border};
                    opacity: ${done || m.forfeited ? '0.7' : '1'};
                ">
                    <div class="mission-icon">${m.icon}</div>
                    <div style="flex:1">
                        <h3 style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                            ${m.title}
                            <span style="font-size:0.78rem;margin-left:auto;color:${border}">
                                ${statusIcon} ${statusLabel}
                            </span>
                        </h3>
                        <p class="mission-time">${m.time}</p>
                        <p class="mission-desc">${m.desc}</p>
                    </div>
                </div>
            `;
        }).join('')}

        <div class="mission-card" style="border:2px solid #ffd93d;background:linear-gradient(135deg,#2d2d2d,#252525)">
            <div style="font-size:1.5rem">📊</div>
            <div style="flex:1">
                <h3 style="color:#ffd93d">Today's Progress</h3>
                <p style="color:#b0b0b0;font-size:0.85rem;margin-top:6px">
                    ${completed}/3 missions complete
                    ${completed === 3
                        ? ' — <strong style="color:#51cf66">Perfect day! ₱0 fine 🎉</strong>'
                        : ` — <strong style="color:#ff6b6b">₱${(3 - completed) * 50} at risk</strong>`}
                </p>
                <p style="color:#b0b0b0;font-size:0.85rem;margin-top:4px">
                    🔥 Streak: <strong style="color:#ffd93d">${AppState.currentUser?.currentStreak || 0} days</strong>
                    &nbsp;|&nbsp; 🏆 Best: <strong style="color:#ffd93d">${AppState.currentUser?.longestStreak || 0} days</strong>
                </p>
            </div>
        </div>

        <div class="how-it-works">
            <div class="how-icon">💰</div>
            <h3>How It Works</h3>
            <ul>
                <li><strong>Perfect Day:</strong> All 3 missions = ₱0 fine</li>
                <li><strong>Miss a Mission:</strong> ₱50 fine per missed mission (up to ₱150/day)</li>
                <li><strong>Auto-forfeit:</strong> Morning/Breakfast locks at 12:00 PM. Bedtime locks at midnight.</li>
                <li><strong>Streak:</strong> Complete all 3 to keep it alive 🔥</li>
                <li><strong>Pay Out:</strong> All members must agree to reset the fund.</li>
            </ul>
        </div>
    `;
}

// ========================
// LEDGER PAGE
// ========================
function renderLedgerPage() {
    if (fundAmount) fundAmount.textContent = '₱' + AppState.totalFund;
    if (!streaksTable) return;

    streaksTable.innerHTML = '';
    const sorted = [...AppState.users].sort((a, b) => (b.currentStreak || 0) - (a.currentStreak || 0));

    sorted.forEach((user, i) => {
        const rank       = ['🥇','🥈','🥉'][i] || `#${i+1}`;
        const avatarHtml = (user.avatarIsUrl && user.avatar?.startsWith('http'))
            ? `<img src="${user.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
            : (user.avatar || '👤');
        const el = document.createElement('div');
        el.className = 'streak-row';
        el.innerHTML = `
            <div class="streak-row-avatar">${avatarHtml}</div>
            <div class="streak-row-info">
                <div class="streak-row-name">${rank} ${escapeHtml(user.name || 'Homie')}</div>
                <div class="streak-row-stats">
                    <span class="stat"><span class="stat-value">${user.currentStreak || 0}</span> Days 🔥</span>
                    <span class="stat"><span class="stat-value">₱${user.owedFines || 0}</span> Owes</span>
                    ${user.isPerfect ? `<span class="stat">💎 Perfect</span>` : ''}
                </div>
            </div>
        `;
        streaksTable.appendChild(el);
    });

    // Wire Pay Out button
    const payoutBtn = document.querySelector('.btn-payout');
    if (payoutBtn) {
        payoutBtn.onclick = handlePayoutVote;
    }
}

// ========================
// UI HELPERS
// ========================
function updateUI() { updateMenuProfile(); updateProfileDisplay(); }

function updateMenuProfile() {
    if (!AppState.currentUser) return;
    const pic  = document.getElementById('menuProfilePic');
    const name = document.getElementById('menuProfileName');
    const av   = AppState.currentUser.avatar;
    if (pic) {
        if (AppState.currentUser.avatarIsUrl && av?.startsWith('http')) {
            pic.innerHTML = `<img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        } else {
            pic.textContent = av || '👤';
        }
    }
    if (name) name.textContent = AppState.currentUser.name || 'User';
}

function openModal(el)  { closeAllModals(); el.classList.add('active'); modalOverlay.classList.add('active'); }
function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    modalOverlay.classList.remove('active');
}

// Toast notification
function showToast(msg, bg = '#4ecdc4') {
    const t = document.createElement('div');
    t.style.cssText = `
        position:fixed; top:72px; left:50%; transform:translateX(-50%);
        background:${bg}; color:#fff; padding:10px 20px; border-radius:999px;
        font-weight:700; font-size:0.9rem; z-index:9999;
        box-shadow:0 4px 20px rgba(0,0,0,0.4); white-space:nowrap;
        max-width:90vw; text-align:center;
        animation:fadeInUp 0.35s ease;
    `;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}

// ========================
// UTILITIES
// ========================
function formatTime(date) {
    if (!date) return '';
    if (!(date instanceof Date)) date = new Date(date);
    if (isNaN(date)) return '';
    const diff  = Date.now() - date.getTime();
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    if (mins  < 1)  return 'just now';
    if (mins  < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(text) {
    const m = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' };
    return String(text || '').replace(/[&<>"']/g, c => m[c]);
}

// Make scrollToMessage globally accessible (called from inline onclick)
window.scrollToMessage = scrollToMessage;

console.log('🏠 My Homies — Firebase + Streaks + All Features loaded.');
