// test_sync_scenarios.js
// Automated mock tests for Firebase sync integrity and overwrite protection

// 1. Mock global app state
let state = {
    roommates: [],
    transactions: [],
    settings: {
        syncKey: "test-sync",
        firebaseConfig: "some-config"
    }
};

let isDemoMode = false;
let mockFirebaseDb = {}; // Simulates the remote Firebase Realtime Database
let firebasePushCount = 0;

// Mock pushToFirebase
function pushToFirebase() {
    if (isDemoMode) {
        console.log("[Demo Mode] push blocked");
        return;
    }
    if (!state.roommates || state.roommates.length === 0) {
        console.log("Push blocked: Roommate list is empty.");
        return;
    }
    
    // Simulate setting data in Firebase
    mockFirebaseDb[state.settings.syncKey] = {
        roommates: JSON.parse(JSON.stringify(state.roommates)),
        transactions: JSON.parse(JSON.stringify(state.transactions))
    };
    firebasePushCount++;
    console.log(`[Firebase Push #${firebasePushCount}] Pushed to remote:`, {
        roommates: state.roommates.length,
        transactions: state.transactions.length
    });
}

// Mock listener snapshot trigger
function triggerRemoteSync(syncKey, remoteData) {
    console.log(`[Firebase Callback] Remote snapshot received for: ${syncKey}`);
    const data = remoteData;

    if (data === null) {
        if (state.transactions.length > 0 && state.roommates.length > 0) {
            console.log("Firebase path is new — seeding with local data...");
            pushToFirebase();
        }
        return;
    }

    console.log("Received remote sync from Firebase RTDB. Merging...");
    
    if (data.roommates && data.roommates.length > 0) {
        state.roommates = JSON.parse(JSON.stringify(data.roommates));
    }

    const remoteTxs = data.transactions || [];
    let mergedTxs = JSON.parse(JSON.stringify(state.transactions));
    let needPushBack = false;

    remoteTxs.forEach(remoteTx => {
        const localIndex = mergedTxs.findIndex(t => t.id === remoteTx.id);
        if (localIndex === -1) {
            mergedTxs.push(remoteTx);
        } else {
            const localTx = mergedTxs[localIndex];
            const localTime = localTx.lastModified || 0;
            const remoteTime = remoteTx.lastModified || 0;
            if (remoteTime > localTime) {
                mergedTxs[localIndex] = remoteTx;
            } else if (localTime > remoteTime) {
                needPushBack = true;
            }
        }
    });

    state.transactions.forEach(localTx => {
        const remoteExists = remoteTxs.some(t => t.id === localTx.id);
        if (!remoteExists) {
            needPushBack = true;
        }
    });

    state.transactions = mergedTxs;

    if (needPushBack) {
        console.log("Local updates detected. Pushing updated state back to Firebase.");
        pushToFirebase();
    }
}

// ------------------- TEST SCENARIOS -------------------

function runTests() {
    console.log("==================================================");
    console.log("RUNNING FIREBASE SYNC OVERWRITE PROTECTION TESTS");
    console.log("==================================================\n");

    // SCENARIO 1: A new user joins an existing passcode "5678"
    // Local: empty. Remote: has 39 transactions.
    console.log("--- TEST case 1: Fresh user joins existing passcode '5678' ---");
    state.roommates = [];
    state.transactions = [];
    state.settings.syncKey = "5678";
    firebasePushCount = 0;
    
    // Remote DB contains active transactions
    const remoteDataStore = {
        roommates: [{ name: "Harsha" }, { name: "Janaki" }],
        transactions: [
            { id: "tx1", amount: 100, lastModified: 100 },
            { id: "tx2", amount: 200, lastModified: 100 }
        ]
    };
    mockFirebaseDb["5678"] = JSON.parse(JSON.stringify(remoteDataStore));

    // Simulate listener firing when connecting
    triggerRemoteSync("5678", mockFirebaseDb["5678"]);

    // Assertions
    console.log("ASSERTIONS:");
    console.log("Local roommates count:", state.roommates.length, "(Expected: 2)");
    console.log("Local transactions count:", state.transactions.length, "(Expected: 2)");
    console.log("Firebase push count:", firebasePushCount, "(Expected: 0 - should NOT upload anything)");
    
    const passed1 = state.roommates.length === 2 && state.transactions.length === 2 && firebasePushCount === 0;
    console.log(passed1 ? "✅ TEST 1 PASSED\n" : "❌ TEST 1 FAILED\n");


    // SCENARIO 2: Local offline additions are merged online without overwriting remote
    console.log("--- TEST case 2: Offline local additions merged online ---");
    // Local has 2 downloaded transactions + 1 new offline transaction
    state.transactions.push({ id: "tx_offline", amount: 50, lastModified: 150 });
    firebasePushCount = 0;

    // Trigger remote sync (simulating connection update)
    triggerRemoteSync("5678", mockFirebaseDb["5678"]);

    console.log("ASSERTIONS:");
    console.log("Local transactions count:", state.transactions.length, "(Expected: 3)");
    console.log("Firebase push count:", firebasePushCount, "(Expected: 1 - should upload the new transaction)");
    console.log("Remote transactions count in Firebase DB:", mockFirebaseDb["5678"].transactions.length, "(Expected: 3)");

    const passed2 = state.transactions.length === 3 && firebasePushCount === 1 && mockFirebaseDb["5678"].transactions.length === 3;
    console.log(passed2 ? "✅ TEST 2 PASSED\n" : "❌ TEST 2 FAILED\n");


    // SCENARIO 3: Conflict resolution - Newer modification wins
    console.log("--- TEST case 3: Conflict resolution (newer timestamp wins) ---");
    // Remote has modified tx1 to amount 150 (newer time: 200)
    mockFirebaseDb["5678"].transactions[0].amount = 150;
    mockFirebaseDb["5678"].transactions[0].lastModified = 200;

    // Local has modified tx1 to amount 180 (older time: 180)
    state.transactions[0].amount = 180;
    state.transactions[0].lastModified = 180;
    
    firebasePushCount = 0;

    triggerRemoteSync("5678", mockFirebaseDb["5678"]);

    console.log("ASSERTIONS:");
    console.log("Local tx1 amount:", state.transactions.find(t => t.id === "tx1").amount, "(Expected: 150 - remote won)");
    console.log("Firebase push count:", firebasePushCount, "(Expected: 0 - local didn't need to push back)");

    const passed3 = state.transactions.find(t => t.id === "tx1").amount === 150 && firebasePushCount === 0;
    console.log(passed3 ? "✅ TEST 3 PASSED\n" : "❌ TEST 3 FAILED\n");


    // SCENARIO 4: Seeding a brand new sync key
    console.log("--- TEST case 4: Seeding a fresh sync key ---");
    // Local has configured roommates and transactions
    state.roommates = [{ name: "UserA" }, { name: "UserB" }];
    state.transactions = [{ id: "tx_init", amount: 500, lastModified: 100 }];
    state.settings.syncKey = "fresh-new-passcode";
    
    mockFirebaseDb["fresh-new-passcode"] = null; // Remote database is empty
    firebasePushCount = 0;

    triggerRemoteSync("fresh-new-passcode", null);

    console.log("ASSERTIONS:");
    console.log("Firebase push count:", firebasePushCount, "(Expected: 1 - seeded successfully)");
    console.log("Remote database has seeded:", mockFirebaseDb["fresh-new-passcode"] !== null);
    
    const passed4 = firebasePushCount === 1 && mockFirebaseDb["fresh-new-passcode"] !== null;
    console.log(passed4 ? "✅ TEST 4 PASSED\n" : "❌ TEST 4 FAILED\n");
}

runTests();
