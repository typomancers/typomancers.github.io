/**
 * Typomancers Client
 *
 * A thin client that handles UI rendering and server communication.
 * All game logic is server-authoritative.
 */

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

    renderPlayerCards();

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

        // Determine spell type display
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
                typeLabel = 'Heal Self';
                typeClass = 'type-heal';
                break;
            case 'shield':
                typeLabel = 'Shield Self';
                typeClass = 'type-shield';
                break;
        }

        html += `
            <button class="spell-btn ${selected ? 'selected' : ''} ${typeClass}" data-spell-id="${spell.id}">
                <div class="spell-type-badge">${typeLabel}</div>
                <div class="spell-name">${escapeHtml(spell.name)}</div>
                <div class="spell-value">Max Value: ${spell.max_value}</div>
                <div class="spell-desc">${escapeHtml(spell.description)}</div>
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
    let html = '';

    for (let i = 0; i < expected.length; i++) {
        if (i < typed.length) {
            if (typed[i] === expected[i]) {
                html += `<span class="correct">${escapeHtml(expected[i])}</span>`;
            } else {
                html += `<span class="incorrect">${escapeHtml(expected[i])}</span>`;
            }
        } else {
            html += `<span class="pending">${escapeHtml(expected[i])}</span>`;
        }
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

    let html = '';
    for (const effect of resolution.effects) {
        const isSelf = effect.caster_id === state.playerId;
        const casterIndex = getPlayerIndex(effect.caster_id);
        const casterSprite = getPlayerSprite(casterIndex, 'attack');

        html += `
            <div class="spell-effect ${isSelf ? 'self-effect' : ''}">
                <div class="effect-header">
                    <img src="${casterSprite}" alt="${escapeHtml(effect.caster_name)}" class="effect-caster-sprite">
                    <div class="effect-header-text">
                        <span class="caster">${escapeHtml(effect.caster_name)} cast ${escapeHtml(effect.spell_name)}!</span>
                        <span class="accuracy">${effect.accuracy_percent.toFixed(1)}% accuracy</span>
                    </div>
                </div>
                <div class="effect-targets">
        `;

        // Show effect on each target
        for (const target of effect.targets) {
            let effectText = '';
            let effectClass = '';

            if (target.damage_dealt !== undefined && target.damage_dealt !== null) {
                effectText = `-${target.damage_dealt} HP`;
                effectClass = 'damage';
                if (target.was_killed) {
                    effectText += ' - DEFEATED!';
                    effectClass += ' kill';
                }
            } else if (target.healing_received !== undefined && target.healing_received !== null) {
                effectText = `+${target.healing_received} HP`;
                effectClass = 'healing';
            } else if (target.shield_effectiveness !== undefined && target.shield_effectiveness !== null) {
                effectText = `${target.shield_effectiveness.toFixed(1)}% shield`;
                effectClass = 'shield';
            }

            html += `
                    <div class="target-effect ${effectClass}">
                        <span class="target-name">${escapeHtml(target.target_name)}:</span>
                        <span class="effect-value">${effectText}</span>
                        <span class="hp-after">(${target.hp_after} HP)</span>
                    </div>
            `;
        }

        html += `
                </div>
                <div class="effect-incantation">
                    <span class="expected">"${escapeHtml(effect.incantation)}"</span>
                    <span class="typed"> → "${escapeHtml(effect.typed_text)}"</span>
                </div>
            </div>
        `;
    }

    if (resolution.effects.length === 0) {
        html = '<p>No spells cast this turn.</p>';
    }

    elements.resolutionResults.innerHTML = html;
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

// ============================================
// Keep-Alive Ping
// ============================================

setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        send({ type: 'ping' });
    }
}, 30000);
