/**
 * Typomancers Client
 *
 * A thin client that handles UI rendering and server communication.
 * All game logic is server-authoritative.
 */

// ============================================
// Image Preloader
// ============================================

const imagePreloader = {
    images: [],
    loaded: 0,
    total: 0,

    // All game images to preload
    imagePaths: [
        // Backgrounds
        'assets/background_0.png',
        'assets/background_1.png',
        // Title
        'assets/TypomancersTitle.png',
        // Wizard sprites
        'assets/green_idle.png',
        'assets/green_attack.png',
        'assets/red_idle.png',
        'assets/red_attack.png',
        'assets/white_idle.png',
        'assets/white_attack.png',
        // Spell cards
        'assets/spell_cards/card_img_light_attack.png',
        'assets/spell_cards/card_img_heavy_attack.png',
        'assets/spell_cards/card_img_group_attack.png',
        'assets/spell_cards/card_img_healing.png',
        'assets/spell_cards/card_img_shield.png',
    ],

    preload(onProgress, onComplete) {
        this.total = this.imagePaths.length;
        this.loaded = 0;

        if (this.total === 0) {
            if (onComplete) onComplete();
            return;
        }

        this.imagePaths.forEach(path => {
            const img = new Image();
            img.onload = () => {
                this.loaded++;
                if (onProgress) onProgress(this.loaded, this.total);
                if (this.loaded === this.total && onComplete) {
                    onComplete();
                }
            };
            img.onerror = () => {
                console.warn(`Failed to preload: ${path}`);
                this.loaded++;
                if (onProgress) onProgress(this.loaded, this.total);
                if (this.loaded === this.total && onComplete) {
                    onComplete();
                }
            };
            img.src = path;
            this.images.push(img);
        });
    }
};

// Start preloading immediately
imagePreloader.preload(
    (loaded, total) => {
        const percent = Math.round((loaded / total) * 100);
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.textContent = `Loading assets... ${percent}%`;
            if (loaded === total) {
                loadingIndicator.textContent = 'Ready!';
                setTimeout(() => {
                    loadingIndicator.style.display = 'none';
                }, 500);
            }
        }
    },
    () => {
        console.log('All images preloaded');
    }
);

// ============================================
// State
// ============================================

const state = {
    ws: null,
    playerId: null,
    playerName: null,
    roomId: null,
    roomState: null,
    gameState: null,
    selectedSpell: null,
    selectedTarget: null,
    typingStartTime: null,
    typingSubmitted: false,
    timerInterval: null,
};

// ============================================
// DOM Elements
// ============================================

const elements = {
    // Screens
    landingScreen: document.getElementById('landing-screen'),
    lobbyScreen: document.getElementById('lobby-screen'),
    gameScreen: document.getElementById('game-screen'),
    gameoverScreen: document.getElementById('gameover-screen'),

    // Landing
    joinForm: document.getElementById('join-form'),
    playerNameInput: document.getElementById('player-name'),
    serverUrlInput: document.getElementById('server-url'),
    roomIdInput: document.getElementById('room-id'),
    timerSecondsInput: document.getElementById('timer-seconds'),
    connectionError: document.getElementById('connection-error'),

    // Lobby
    lobbyRoomId: document.getElementById('lobby-room-id'),
    lobbyPlayers: document.getElementById('lobby-players'),
    playersNeeded: document.getElementById('players-needed'),

    // Game
    turnNumber: document.getElementById('turn-number'),
    phaseIndicator: document.getElementById('phase-indicator'),
    timerDisplay: document.getElementById('timer-display'),
    playersStatus: document.getElementById('players-status'),

    // Phases
    spellSelection: document.getElementById('spell-selection'),
    spellOptions: document.getElementById('spell-options'),
    targetSelection: document.getElementById('target-selection'),
    targetOptions: document.getElementById('target-options'),
    typingPhase: document.getElementById('typing-phase'),
    incantationText: document.getElementById('incantation-text'),
    typingInput: document.getElementById('typing-input'),
    typingFeedback: document.getElementById('typing-feedback'),
    submitTypingBtn: document.getElementById('submit-typing-btn'),
    resolutionPhase: document.getElementById('resolution-phase'),
    resolutionResults: document.getElementById('resolution-results'),
    waitingOverlay: document.getElementById('waiting-overlay'),
    waitingMessage: document.getElementById('waiting-message'),

    // Game Over
    gameoverTitle: document.getElementById('gameover-title'),
    winnerName: document.getElementById('winner-name'),
    playerStats: document.getElementById('player-stats'),
    finalScores: document.getElementById('final-scores'),
    playAgainBtn: document.getElementById('play-again-btn'),
};

// ============================================
// Screen Management
// ============================================

function showScreen(screenId) {
    ['landing-screen', 'lobby-screen', 'game-screen', 'gameover-screen'].forEach(id => {
        const el = document.getElementById(id);
        if (id === screenId) {
            el.classList.remove('hidden');
            el.classList.add('active');
        } else {
            el.classList.add('hidden');
            el.classList.remove('active');
        }
    });
}

// ============================================
// WebSocket Communication
// ============================================

function connect(serverUrl) {
    return new Promise((resolve, reject) => {
        try {
            // Normalize URL: ensure it starts with ws:// or wss://
            let wsUrl = serverUrl.trim();
            if (wsUrl.startsWith('https://')) {
                wsUrl = 'wss://' + wsUrl.slice(8);
            } else if (wsUrl.startsWith('http://')) {
                wsUrl = 'ws://' + wsUrl.slice(7);
            } else if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
                // Assume ws:// for bare URLs
                wsUrl = 'ws://' + wsUrl;
            }

            state.ws = new WebSocket(wsUrl);

            state.ws.onopen = () => {
                resolve();
            };

            state.ws.onclose = () => {
                showError('Connection lost. Please refresh the page.');
            };

            state.ws.onerror = () => {
                reject(new Error('Failed to connect to server. Check the server URL and ensure the server is running.'));
            };

            state.ws.onmessage = (event) => {
                handleServerMessage(JSON.parse(event.data));
            };
        } catch (err) {
            reject(err);
        }
    });
}

function send(message) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(message));
    }
}

function handleServerMessage(msg) {
    switch (msg.type) {
        case 'joined_room':
            handleJoinedRoom(msg);
            break;
        case 'error':
            handleError(msg);
            break;
        case 'room_update':
            handleRoomUpdate(msg);
            break;
        case 'game_update':
            handleGameUpdate(msg);
            break;
        case 'pong':
            // Keep-alive response, ignore
            break;
    }
}

// ============================================
// Message Handlers
// ============================================

function handleJoinedRoom(msg) {
    state.playerId = msg.player_id;
    state.roomId = msg.room_id;
    state.roomState = msg.room_state;

    if (msg.room_state.phase === 'waiting_for_players') {
        showLobby();
    } else {
        // Game already in progress (reconnect scenario or instant start)
        showScreen('game-screen');
        // If we already have game state (from a GameUpdate that arrived first), render it now
        if (state.gameState) {
            renderGame();
            // Start resolution timer if we're joining during resolution phase
            if (state.gameState.phase === 'resolution') {
                startResolutionTimer();
            }
        }
    }
}

function handleError(msg) {
    showError(msg.message);
}

function handleRoomUpdate(msg) {
    state.roomState = msg.room_state;

    if (state.roomState.phase === 'waiting_for_players') {
        renderLobby();
    }
}

function handleGameUpdate(msg) {
    const previousPhase = state.gameState?.phase;
    const newPhase = msg.game_state.phase;

    state.gameState = msg.game_state;

    // If we don't have our player ID yet (JoinedRoom hasn't arrived),
    // just store the state and wait. handleJoinedRoom will call renderGame.
    if (!state.playerId) {
        return;
    }

    // Only reset per-turn state when phase CHANGES to spell_selection (new turn)
    if (newPhase === 'spell_selection' && previousPhase !== 'spell_selection') {
        state.selectedSpell = null;
        state.selectedTarget = null;
        state.typingSubmitted = false;
        state.typingStartTime = null;
        stopTimer();
    }

    // Reset typing state when leaving typing phase
    if (previousPhase === 'typing' && newPhase !== 'typing') {
        state.typingStartTime = null;
        stopTimer();
    }

    // Start resolution timer when entering resolution phase
    if (newPhase === 'resolution' && previousPhase !== 'resolution') {
        startResolutionTimer();
    }

    // Stop resolution timer when leaving resolution phase
    if (previousPhase === 'resolution' && newPhase !== 'resolution') {
        stopTimer();
    }

    if (newPhase === 'game_over') {
        showGameOver();
    } else {
        showScreen('game-screen');
        renderGame();
    }
}

// ============================================
// Landing Screen
// ============================================

elements.joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const playerName = elements.playerNameInput.value.trim();
    const serverUrl = elements.serverUrlInput.value.trim();
    const roomId = elements.roomIdInput.value.trim();
    const timerSeconds = parseInt(elements.timerSecondsInput.value) || 30;

    if (!playerName || !serverUrl || !roomId) {
        showError('Please fill in all fields');
        return;
    }

    state.playerName = playerName;

    try {
        hideError();
        await connect(serverUrl);

        // Send join request
        send({
            type: 'join_room',
            room_id: roomId,
            player_name: playerName,
            timer_seconds: timerSeconds,
        });
    } catch (err) {
        showError(err.message);
    }
});

function showError(message) {
    elements.connectionError.textContent = message;
    elements.connectionError.classList.remove('hidden');
}

function hideError() {
    elements.connectionError.classList.add('hidden');
}

// ============================================
// Lobby Screen
// ============================================

function showLobby() {
    showScreen('lobby-screen');
    renderLobby();
}

function renderLobby() {
    const room = state.roomState;
    elements.lobbyRoomId.textContent = room.room_id;

    // Render player slots
    let html = '';
    for (let i = 0; i < room.max_players; i++) {
        const player = room.players[i];
        if (player) {
            const isSelf = player.id === state.playerId;
            const spriteUrl = getPlayerSprite(i, 'idle');
            html += `
                <div class="player-slot ${isSelf ? 'self' : ''}">
                    <img src="${spriteUrl}" alt="Player ${i + 1}" class="player-sprite">
                    <div class="player-name">${escapeHtml(player.name)}${isSelf ? ' (You)' : ''}</div>
                </div>
            `;
        } else {
            html += `
                <div class="player-slot empty">
                    <div class="player-icon">❓</div>
                    <div class="player-name">Waiting...</div>
                </div>
            `;
        }
    }
    elements.lobbyPlayers.innerHTML = html;
    elements.playersNeeded.textContent = room.max_players - room.players.length;
}

// ============================================
// Game Screen
// ============================================

function renderGame() {
    const game = state.gameState;
    if (!game) {
        return;
    }
    if (!state.playerId) {
        return;
    }

    elements.turnNumber.textContent = game.turn_number;
    elements.phaseIndicator.textContent = formatPhase(game.phase);

    // Hide player cards during resolution phase (they're shown in the animation)
    if (game.phase === 'resolution') {
        elements.playersStatus.classList.add('hidden');
    } else {
        elements.playersStatus.classList.remove('hidden');
        renderPlayerCards();
    }

    // Hide all phase content
    elements.spellSelection.classList.add('hidden');
    elements.targetSelection.classList.add('hidden');
    elements.typingPhase.classList.add('hidden');
    elements.resolutionPhase.classList.add('hidden');
    elements.waitingOverlay.classList.add('hidden');
    elements.timerDisplay.classList.add('hidden');

    // Get current player
    const self = game.players.find(p => p.id === state.playerId);
    if (!self) {
        return;
    }
    const isDead = !self.is_alive;

    if (isDead) {
        showWaiting('You have been defeated. Spectating...');
        return;
    }

    // Show appropriate phase content
    switch (game.phase) {
        case 'spell_selection':
            renderSpellSelection();
            break;
        case 'target_selection':
            renderTargetSelection();
            break;
        case 'typing':
            renderTypingPhase();
            break;
        case 'resolution':
            renderResolution();
            break;
    }
}

function renderPlayerCards() {
    const game = state.gameState;
    let html = '';

    for (const player of game.players) {
        const isSelf = player.id === state.playerId;
        const playerIndex = getPlayerIndex(player.id);
        const spriteUrl = getPlayerSprite(playerIndex, 'idle');
        const hpPercent = Math.max(0, (player.hp / player.max_hp) * 100);
        let hpClass = '';
        if (hpPercent <= 25) hpClass = 'low';
        else if (hpPercent <= 50) hpClass = 'mid';

        let statusText = '';
        let statusClass = '';

        if (!player.is_alive) {
            statusText = 'Defeated';
        } else {
            switch (game.phase) {
                case 'spell_selection':
                    statusText = player.has_selected_spell ? 'Spell Ready' : 'Choosing...';
                    statusClass = player.has_selected_spell ? 'ready' : '';
                    break;
                case 'target_selection':
                    statusText = player.has_selected_target ? 'Target Locked' : 'Targeting...';
                    statusClass = player.has_selected_target ? 'ready' : '';
                    break;
                case 'typing':
                    statusText = player.has_finished_typing ? 'Done!' : 'Casting...';
                    statusClass = player.has_finished_typing ? 'ready' : '';
                    break;
            }
        }

        html += `
            <div class="player-card ${isSelf ? 'self' : ''} ${!player.is_alive ? 'dead' : ''}">
                <img src="${spriteUrl}" alt="${escapeHtml(player.name)}" class="player-card-sprite">
                <div class="player-info">
                    <div class="player-name">${escapeHtml(player.name)}${isSelf ? ' (You)' : ''}</div>
                    <div class="hp-bar">
                        <div class="hp-fill ${hpClass}" style="width: ${hpPercent}%"></div>
                    </div>
                    <div class="hp-text">${player.hp} / ${player.max_hp} HP</div>
                    <div class="status-indicator ${statusClass}">${statusText}</div>
                </div>
            </div>
        `;
    }

    elements.playersStatus.innerHTML = html;
}

// ============================================
// Spell Selection Phase
// ============================================

function renderSpellSelection() {
    const game = state.gameState;
    const self = game.players.find(p => p.id === state.playerId);

    // Check if we already selected
    if (!self) {
        return;
    }
    if (self.has_selected_spell) {
        showWaiting('Waiting for other wizards to choose their spells...');
        return;
    }

    elements.spellSelection.classList.remove('hidden');

    let html = '';
    for (const spell of game.available_spells) {
        const selected = state.selectedSpell === spell.id;

        // Determine spell type display and image
        let typeLabel = '';
        let typeClass = '';
        switch (spell.spell_type) {
            case 'attack':
                typeLabel = 'Attack';
                typeClass = 'type-attack';
                break;
            case 'attack_all':
                typeLabel = 'Area Attack';
                typeClass = 'type-attack-all';
                break;
            case 'heal':
                typeLabel = 'Heal';
                typeClass = 'type-heal';
                break;
            case 'shield':
                typeLabel = 'Shield';
                typeClass = 'type-shield';
                break;
        }

        // Get the spell card image
        const spellImageSrc = getSpellImage(spell.name, spell.spell_type);

        // Format difficulty for display
        const difficultyLabel = spell.difficulty.charAt(0).toUpperCase() + spell.difficulty.slice(1);
        const difficultyClass = `difficulty-${spell.difficulty}`;

        html += `
            <button class="spell-btn ${selected ? 'selected' : ''} ${typeClass}" data-spell-id="${spell.id}">
                <div class="spell-type-badge">${typeLabel}</div>
                <div class="spell-image">
                    <img src="${spellImageSrc}" alt="${escapeHtml(spell.name)}">
                </div>
                <div class="spell-card-body">
                    <div class="spell-name">${escapeHtml(spell.name)}</div>
                    <div class="spell-stats">
                        <div class="spell-value">⚡ ${spell.max_value}</div>
                        <div class="spell-stats-divider"></div>
                        <div class="spell-difficulty ${difficultyClass}">${difficultyLabel}</div>
                    </div>
                </div>
            </button>
        `;
    }
    elements.spellOptions.innerHTML = html;

    // Add click handlers
    elements.spellOptions.querySelectorAll('.spell-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const spellId = btn.dataset.spellId;
            state.selectedSpell = spellId;

            // Update UI
            elements.spellOptions.querySelectorAll('.spell-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');

            // Send to server
            send({ type: 'select_spell', spell_id: spellId });
        });
    });
}

// ============================================
// Target Selection Phase
// ============================================

function renderTargetSelection() {
    const game = state.gameState;
    const self = game.players.find(p => p.id === state.playerId);

    if (self.has_selected_target) {
        showWaiting('Waiting for other wizards to choose their targets...');
        return;
    }

    elements.targetSelection.classList.remove('hidden');

    let html = '';
    for (const player of game.players) {
        if (player.id === state.playerId) continue; // Can't target self

        const disabled = !player.is_alive;
        const selected = state.selectedTarget === player.id;

        html += `
            <button class="target-btn ${selected ? 'selected' : ''}"
                    data-target-id="${player.id}"
                    ${disabled ? 'disabled' : ''}>
                ${escapeHtml(player.name)}
                <span class="target-hp">${player.hp} HP</span>
            </button>
        `;
    }
    elements.targetOptions.innerHTML = html;

    // Add click handlers
    elements.targetOptions.querySelectorAll('.target-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;

            const targetId = btn.dataset.targetId;
            state.selectedTarget = targetId;

            // Update UI
            elements.targetOptions.querySelectorAll('.target-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');

            // Send to server (as array for protocol compatibility)
            send({ type: 'select_target', target_ids: [targetId] });
        });
    });
}

// ============================================
// Typing Phase
// ============================================

function renderTypingPhase() {
    const game = state.gameState;
    const self = game.players.find(p => p.id === state.playerId);

    if (self.has_finished_typing || state.typingSubmitted) {
        showWaiting('Waiting for other wizards to finish casting...');
        return;
    }

    elements.typingPhase.classList.remove('hidden');
    elements.timerDisplay.classList.remove('hidden');

    const typing = game.typing_phase;
    if (!typing) return;

    elements.incantationText.textContent = typing.incantation;

    // Only reset input and start timer if this is the first render of typing phase
    const isFirstRender = !state.typingStartTime;
    if (isFirstRender) {
        elements.typingInput.value = '';
        state.typingStartTime = Date.now();
        startTimer(typing.duration_ms);
    }

    elements.typingInput.focus();

    // Update feedback with current value (preserves progress on re-render)
    updateTypingFeedback(typing.incantation, elements.typingInput.value);

    // Setup input handler
    elements.typingInput.oninput = () => {
        updateTypingFeedback(typing.incantation, elements.typingInput.value);

        // Check if done typing (typed enough characters)
        if (elements.typingInput.value.length >= typing.incantation.length) {
            // Auto-submit after a small delay
            setTimeout(() => {
                if (!state.typingSubmitted) {
                    submitTyping(true);
                }
            }, 100);
        }
    };

    // Handle submit button
    elements.submitTypingBtn.onclick = () => submitTyping(true);

    // Handle Enter key
    elements.typingInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitTyping(true);
        }
    };
}

function updateTypingFeedback(expected, typed) {
    // Split into words for per-word highlighting
    const expectedWords = expected.split(/(\s+)/); // Preserve spaces
    const typedWords = typed.split(/(\s+)/); // Preserve spaces

    let html = '';
    let typedCharIndex = 0;
    let expectedCharIndex = 0;

    // Determine which word we're currently on by counting non-space words in typed text
    const typedNonSpaceWords = typed.split(/\s+/).filter(w => w.length > 0);
    const currentWordIndex = typedNonSpaceWords.length > 0 ? typedNonSpaceWords.length - 1 : 0;

    let wordIndex = 0;
    for (let i = 0; i < expectedWords.length; i++) {
        const word = expectedWords[i];

        // Handle spaces - just render them as-is
        if (/^\s+$/.test(word)) {
            html += word;
            expectedCharIndex += word.length;
            if (i < typedWords.length) {
                typedCharIndex += (typedWords[i] || '').length;
            }
            continue;
        }

        // This is a non-space word
        const isCurrentWord = wordIndex === currentWordIndex;
        const isCompletedWord = wordIndex < currentWordIndex;
        const typedWord = typedNonSpaceWords[wordIndex] || '';

        if (isCompletedWord) {
            // Grey out completed words
            for (let j = 0; j < word.length; j++) {
                html += `<span class="completed">${escapeHtml(word[j])}</span>`;
            }
        } else if (isCurrentWord) {
            // Show current word with character-by-character red/green
            for (let j = 0; j < word.length; j++) {
                if (j < typedWord.length) {
                    if (typedWord[j] === word[j]) {
                        html += `<span class="correct">${escapeHtml(word[j])}</span>`;
                    } else {
                        html += `<span class="incorrect">${escapeHtml(word[j])}</span>`;
                    }
                } else {
                    html += `<span class="pending">${escapeHtml(word[j])}</span>`;
                }
            }
        } else {
            // Grey out remaining words (not yet started)
            for (let j = 0; j < word.length; j++) {
                html += `<span class="pending">${escapeHtml(word[j])}</span>`;
            }
        }

        wordIndex++;
    }

    elements.typingFeedback.innerHTML = html;
}

function submitTyping(finished) {
    if (state.typingSubmitted) return;
    state.typingSubmitted = true;

    const completionTime = finished ? Date.now() - state.typingStartTime : null;

    send({
        type: 'submit_typing',
        typed_text: elements.typingInput.value,
        completion_time_ms: completionTime,
    });

    stopTimer();
    showWaiting('Spell cast! Waiting for others...');
}

function startTimer(durationMs) {
    // Don't restart if already running
    if (state.timerInterval) {
        return;
    }

    const endTime = state.typingStartTime + durationMs;

    state.timerInterval = setInterval(() => {
        const remaining = Math.max(0, endTime - Date.now());
        const seconds = Math.ceil(remaining / 1000);
        elements.timerDisplay.textContent = `${seconds}s`;

        if (seconds <= 5) {
            elements.timerDisplay.classList.add('warning');
        } else {
            elements.timerDisplay.classList.remove('warning');
        }

        if (remaining <= 0) {
            stopTimer();
            if (!state.typingSubmitted) {
                submitTyping(false);
            }
        }
    }, 100);
}

function stopTimer() {
    if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
    }
    // Note: Don't clear typingStartTime here - it's used to track completion time
    // and to detect if we've already started the typing phase.
    // It gets cleared in handleGameUpdate when the phase changes.
}

function startResolutionTimer() {
    // Don't restart if already running
    if (state.timerInterval) {
        return;
    }

    // Get initial time remaining from server
    const game = state.gameState;
    if (!game || game.phase_time_remaining_ms === undefined || game.phase_time_remaining_ms === null) {
        return;
    }

    const startTime = Date.now();
    const initialRemaining = game.phase_time_remaining_ms;

    state.timerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, initialRemaining - elapsed);
        const seconds = Math.ceil(remaining / 1000);

        elements.timerDisplay.textContent = `Next turn in ${seconds}s`;
        elements.timerDisplay.classList.remove('warning');

        if (remaining <= 0) {
            stopTimer();
        }
    }, 100);
}

// ============================================
// Resolution Phase
// ============================================

function renderResolution() {
    elements.resolutionPhase.classList.remove('hidden');
    elements.timerDisplay.classList.remove('hidden');

    const game = state.gameState;
    const resolution = game.resolution;
    if (!resolution) return;

    // Timer is handled by startResolutionTimer() which runs in the background

    if (resolution.effects.length === 0) {
        elements.resolutionResults.innerHTML = '<p>No spells cast this turn.</p>';
        return;
    }

    // Calculate timing for sequential animations
    // Total time is 10 seconds (DEFAULT_RESOLUTION_SECONDS)
    // This is hardcoded and needs to be changed in both server and client side code.
    const totalDuration = 10000; // 10 seconds in ms
    const numEffects = resolution.effects.length;
    const effectDuration = totalDuration / numEffects;

    // Each effect has 3 stages: caster (33%), spell (33%), targets (34%)
    const casterDelay = effectDuration * 0.33;
    const spellDelay = effectDuration * 0.66;

    // Clear the container
    elements.resolutionResults.innerHTML = '';

    // Create all effect cards and animate them sequentially
    resolution.effects.forEach((effect, index) => {
        const isSelf = effect.caster_id === state.playerId;
        const casterIndex = getPlayerIndex(effect.caster_id);
        const casterSprite = getPlayerSprite(casterIndex, 'attack');
        const spellImage = getSpellImage(effect.spell_name, effect.spell_type);

        // Calculate delays for this effect
        const baseDelay = index * effectDuration;

        // Build stun indicator if caster was stunned
        const stunIndicator = effect.stun_count && effect.stun_count > 0
            ? `<span class="stun-indicator">⚡ Stunned ${effect.stun_count}x (-${effect.stun_count * 33}% effectiveness)</span>`
            : '';

        // Create effect card container
        const effectCard = document.createElement('div');
        effectCard.className = `resolution-card ${isSelf ? 'self-effect' : ''}`;

        // Build the card HTML
        let cardHTML = `
            <div class="resolution-row">
                <div class="resolution-caster fade-element" style="animation-delay: ${baseDelay}ms">
                    <img src="${casterSprite}" alt="${escapeHtml(effect.caster_name)}" class="caster-image">
                    <div class="caster-name">${escapeHtml(effect.caster_name)}</div>
                    ${stunIndicator}
                </div>

                <div class="resolution-spell fade-element" style="animation-delay: ${baseDelay + casterDelay}ms">
                    <img src="${spellImage}" alt="${escapeHtml(effect.spell_name)}" class="spell-image">
                    <div class="spell-info">
                        <div class="spell-name">${escapeHtml(effect.spell_name)}</div>
                        <div class="spell-accuracy">${effect.accuracy_percent.toFixed(1)}% accuracy</div>
                    </div>
                </div>

                <div class="resolution-targets fade-element" style="animation-delay: ${baseDelay + spellDelay}ms">
        `;

        // Add all targets
        effect.targets.forEach(target => {
            const targetIndex = getPlayerIndex(target.target_id);
            const targetSprite = getPlayerSprite(targetIndex, 'idle');

            let effectText = '';
            let effectClass = '';

            if (target.damage_dealt !== undefined && target.damage_dealt !== null) {
                effectText = `-${target.damage_dealt} HP`;
                effectClass = 'damage';
                if (target.was_killed) {
                    effectText = 'DEFEATED!';
                    effectClass += ' kill';
                }
            } else if (target.healing_received !== undefined && target.healing_received !== null) {
                effectText = `+${target.healing_received} HP`;
                effectClass = 'healing';
            } else if (target.shield_effectiveness !== undefined && target.shield_effectiveness !== null) {
                effectText = `${target.shield_effectiveness.toFixed(1)}% shield`;
                effectClass = 'shield';
            }

            cardHTML += `
                <div class="target-item">
                    <img src="${targetSprite}" alt="${escapeHtml(target.target_name)}" class="target-image">
                    <div class="target-info">
                        <div class="target-name">${escapeHtml(target.target_name)}</div>
                        <div class="target-effect ${effectClass}">${effectText}</div>
                        <div class="target-hp">${target.hp_after} HP</div>
                    </div>
                </div>
            `;
        });

        cardHTML += `
                </div>
            </div>
        `;

        effectCard.innerHTML = cardHTML;
        elements.resolutionResults.appendChild(effectCard);
    });
}

// ============================================
// Game Over Screen
// ============================================

function showGameOver() {
    showScreen('gameover-screen');

    const game = state.gameState;
    const winner = game.players.find(p => p.id === game.winner);

    if (winner) {
        elements.winnerName.textContent = winner.name;
    } else {
        elements.winnerName.textContent = 'No one (draw?)';
    }

    // Show player statistics
    if (game.player_stats && game.player_stats.length > 0) {
        let statsHtml = '<h3>Player Statistics</h3><div class="stats-grid">';

        for (const stats of game.player_stats) {
            const playerIndex = getPlayerIndex(stats.player_id);
            const spriteUrl = getPlayerSprite(playerIndex, 'idle');
            const isSelf = stats.player_id === state.playerId;

            statsHtml += `
                <div class="player-stat-card ${isSelf ? 'self' : ''}">
                    <div class="stat-header">
                        <img src="${spriteUrl}" alt="${escapeHtml(stats.player_name)}" class="stat-sprite">
                        <div class="stat-player-name">${escapeHtml(stats.player_name)}</div>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Avg WPM:</span>
                        <span class="stat-value">${stats.avg_wpm.toFixed(1)}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Max WPM:</span>
                        <span class="stat-value">${stats.max_wpm.toFixed(1)}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Damage Dealt:</span>
                        <span class="stat-value damage">${stats.total_damage_dealt}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Damage Taken:</span>
                        <span class="stat-value damage">${stats.total_damage_received}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Healing:</span>
                        <span class="stat-value heal">${stats.total_healing}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Top Spell:</span>
                        <span class="stat-value">${escapeHtml(stats.top_spell)} (${stats.top_spell_count}x)</span>
                    </div>
                </div>
            `;
        }
        statsHtml += '</div>';
        elements.playerStats.innerHTML = statsHtml;
    } else {
        elements.playerStats.innerHTML = '';
    }

    // Show final scores
    let html = '';
    for (const player of game.players) {
        const isWinner = player.id === game.winner;
        html += `
            <div class="final-player ${isWinner ? 'winner' : ''}">
                <div class="name">${escapeHtml(player.name)} ${isWinner ? '👑' : ''}</div>
                <div class="hp">${player.hp} HP remaining</div>
            </div>
        `;
    }
    elements.finalScores.innerHTML = html;
}

elements.playAgainBtn.addEventListener('click', () => {
    send({ type: 'play_again' });
});

// ============================================
// Utility
// ============================================

function showWaiting(message) {
    elements.waitingOverlay.classList.remove('hidden');
    elements.waitingMessage.textContent = message;
}

function formatPhase(phase) {
    const phases = {
        'waiting_for_players': 'Waiting for Players',
        'spell_selection': 'Spell Selection',
        'target_selection': 'Target Selection',
        'typing': 'Cast Your Spell!',
        'resolution': 'Spell Resolution',
        'game_over': 'Game Over',
    };
    return phases[phase] || phase;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Get the sprite color for a player based on their index.
 * Player 1 (index 0) = green, Player 2 (index 1) = white, Player 3 (index 2) = red
 */
function getPlayerSpriteColor(playerIndex) {
    const colors = ['green', 'white', 'red'];
    return colors[playerIndex] || 'green';
}

/**
 * Get the sprite path for a player.
 * @param {number} playerIndex - 0, 1, or 2
 * @param {string} type - 'idle' or 'attack'
 */
function getPlayerSprite(playerIndex, type = 'idle') {
    const color = getPlayerSpriteColor(playerIndex);
    return `assets/${color}_${type}.png`;
}

/**
 * Get player index by ID from the current game state.
 * Returns the player's position in the players array (0, 1, or 2).
 */
function getPlayerIndex(playerId) {
    if (!state.gameState && !state.roomState) return 0;

    // Try game state first
    if (state.gameState) {
        const index = state.gameState.players.findIndex(p => p.id === playerId);
        if (index !== -1) return index;
    }

    // Fall back to room state
    if (state.roomState) {
        const index = state.roomState.players.findIndex(p => p.id === playerId);
        if (index !== -1) return index;
    }

    return 0;
}

/**
 * Get spell card image path based on spell type.
 */
function getSpellCardImage(spellType) {
    const mapping = {
        'attack': 'assets/spell_cards/card_img_light_attack.png',
        'attack_all': 'assets/spell_cards/card_img_group_attack.png',
        'heal': 'assets/spell_cards/card_img_healing.png',
        'shield': 'assets/spell_cards/card_img_shield.png'
    };
    return mapping[spellType] || 'assets/spell_cards/card_img_light_attack.png';
}

/**
 * Map spell names to determine if they should use heavy attack image.
 */
function getSpellImage(spellName, spellType) {
    if (spellType === 'attack') {
        // Use heavy attack for Heartwood Wrath, light attack for Foxfire Shard
        if (spellName === 'Heartwood Wrath') {
            return 'assets/spell_cards/card_img_heavy_attack.png';
        }
        return 'assets/spell_cards/card_img_light_attack.png';
    }
    return getSpellCardImage(spellType);
}

// ============================================
// Keep-Alive Ping
// ============================================

setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        send({ type: 'ping' });
    }
}, 30000);

// ============================================
// Background Animation
// ============================================

(function initBackgroundAnimation() {
    const layers = document.querySelectorAll('.background-layer');
    if (layers.length === 0) return;

    let currentIndex = 0;
    const transitionDuration = 300; // matches CSS transition time

    function cycleBackground() {
        const outgoingIndex = currentIndex;
        const incomingIndex = (currentIndex + 1) % layers.length;

        // Mark outgoing (keeps it visible during transition)
        layers[outgoingIndex].classList.remove('active');
        layers[outgoingIndex].classList.add('outgoing');

        // Mark incoming (fades in on top)
        layers[incomingIndex].classList.add('active');

        // After transition completes, clean up outgoing
        setTimeout(() => {
            layers[outgoingIndex].classList.remove('outgoing');
        }, transitionDuration);

        currentIndex = incomingIndex;
    }

    // Cycle every 0.3 second
    const backgroundCycleTime = 300;
    setInterval(cycleBackground, backgroundCycleTime);
})();
