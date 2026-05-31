// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ArcadeLeaderboard
 * @notice On-chain leaderboard for Tasern Arcade (100 games).
 *         Gas-optimized for Base L2. Scores are immutable once submitted.
 *
 * @dev Architecture:
 *   - Fixed-size top 10 arrays per game (no dynamic allocation)
 *   - Tight struct packing: address(20) + uint256(32) + uint48(6) = 58 bytes
 *   - Owner registers valid gameIds to prevent spam
 *   - Optional: game client signature verification (see submitScoreWithSig)
 */
contract ArcadeLeaderboard {

    // ─── Structs ────────────────────────────────────────────────────────

    struct Score {
        address player;
        uint256 score;
        uint48 timestamp;
    }

    // ─── State ──────────────────────────────────────────────────────────

    /// @notice Owner — can register games, cannot modify scores
    address public owner;

    /// @notice Whether a gameId is valid (registered)
    mapping(uint16 => bool) public gameRegistered;

    /// @notice Human-readable game name
    mapping(uint16 => string) public gameName;

    /// @notice Top 10 scores per game, sorted descending (index 0 = highest)
    /// @dev Fixed-size array avoids dynamic allocation gas costs
    mapping(uint16 => Score[10]) internal _topScores;

    /// @notice Personal best per game per player
    mapping(uint16 => mapping(address => uint256)) public personalBest;

    /// @notice Total games played per player (increments on every submission)
    mapping(address => uint32) public gamesPlayed;

    /// @notice List of gameIds a player has scored in (for profile lookup)
    mapping(address => uint16[]) internal _playerGames;

    /// @notice Track if player already has a score for a game (avoid duplicate in _playerGames)
    mapping(address => mapping(uint16 => bool)) internal _hasPlayed;

    /// @notice Total registered games count
    uint16 public totalGames;

    // ─── Events ─────────────────────────────────────────────────────────

    event NewHighScore(uint16 indexed gameId, address indexed player, uint256 score);
    event NewTopScore(uint16 indexed gameId, address indexed player, uint256 score, uint8 rank);
    event GameRegistered(uint16 indexed gameId, string name);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ─── Errors ─────────────────────────────────────────────────────────

    error NotOwner();
    error GameNotRegistered();
    error ZeroScore();
    error GameAlreadyRegistered();
    error ArrayLengthMismatch();
    error ZeroAddress();

    // ─── Modifiers ──────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ─── Constructor ────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ─── Admin Functions ────────────────────────────────────────────────

    /// @notice Register a single game
    function registerGame(uint16 gameId, string calldata name) external onlyOwner {
        if (gameRegistered[gameId]) revert GameAlreadyRegistered();
        gameRegistered[gameId] = true;
        gameName[gameId] = name;
        totalGames++;
        emit GameRegistered(gameId, name);
    }

    /// @notice Batch-register games (for initial 100 setup)
    function batchRegisterGames(uint16[] calldata gameIds, string[] calldata names) external onlyOwner {
        if (gameIds.length != names.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < gameIds.length; i++) {
            if (gameRegistered[gameIds[i]]) revert GameAlreadyRegistered();
            gameRegistered[gameIds[i]] = true;
            gameName[gameIds[i]] = names[i];
            totalGames++;
            emit GameRegistered(gameIds[i], names[i]);
        }
    }

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ─── Core Functions ─────────────────────────────────────────────────

    /**
     * @notice Submit a score for a registered game
     * @param gameId The game identifier (must be registered)
     * @param score The player's score (higher = better)
     *
     * @dev Gas optimization notes:
     *   - Early exit if score doesn't beat personal best AND isn't top 10
     *   - Insertion sort on fixed array (shift down, insert)
     *   - Single SSTORE for personal best update
     *
     * NOTE: For production, consider adding signature verification so only
     * the game client can submit scores. Example:
     *   function submitScoreWithSig(uint16 gameId, uint256 score, bytes calldata sig)
     *   - Recover signer from hash(gameId, score, player, nonce)
     *   - Verify signer == trustedGameServer
     *   This prevents players from calling submitScore directly with fake scores.
     */
    function submitScore(uint16 gameId, uint256 score) external {
        if (!gameRegistered[gameId]) revert GameNotRegistered();
        if (score == 0) revert ZeroScore();

        // Increment games played counter
        gamesPlayed[msg.sender]++;

        // Track which games this player has participated in
        if (!_hasPlayed[msg.sender][gameId]) {
            _hasPlayed[msg.sender][gameId] = true;
            _playerGames[msg.sender].push(gameId);
        }

        // Check and update personal best
        bool isNewPersonalBest = score > personalBest[gameId][msg.sender];
        if (isNewPersonalBest) {
            personalBest[gameId][msg.sender] = score;
            emit NewHighScore(gameId, msg.sender, score);
        }

        // Attempt top 10 insertion
        // Only try if score beats the lowest in top 10 (index 9)
        Score[10] storage top = _topScores[gameId];

        // If top 10 isn't full (score == 0 means empty slot), or score beats #10
        if (top[9].score == 0 || score > top[9].score) {
            _insertIntoTop10(top, gameId, msg.sender, score);
        }
    }

    /**
     * @dev Insertion sort into fixed top-10 array (descending order)
     *      Finds the correct position, shifts everything below down by one,
     *      and inserts the new score.
     */
    function _insertIntoTop10(
        Score[10] storage top,
        uint16 gameId,
        address player,
        uint256 score
    ) internal {
        // Find insertion point (first index where new score is higher)
        uint8 insertAt = 10;
        for (uint8 i = 0; i < 10; i++) {
            if (score > top[i].score) {
                insertAt = i;
                break;
            }
        }

        // If not in top 10, bail (shouldn't happen due to caller check, but safety)
        if (insertAt >= 10) return;

        // Shift entries down from position 9 to insertAt+1
        for (uint8 i = 9; i > insertAt; i--) {
            top[i] = top[i - 1];
        }

        // Insert new score
        top[insertAt] = Score({
            player: player,
            score: score,
            timestamp: uint48(block.timestamp)
        });

        // Rank is 1-indexed for the event
        emit NewTopScore(gameId, player, score, insertAt + 1);
    }

    // ─── View Functions ─────────────────────────────────────────────────

    /// @notice Get top 10 scores for a game
    function getTopScores(uint16 gameId) external view returns (Score[10] memory) {
        return _topScores[gameId];
    }

    /// @notice Get a player's personal best for a specific game
    function getPersonalBest(uint16 gameId, address player) external view returns (uint256) {
        return personalBest[gameId][player];
    }

    /// @notice Get player profile: total games played + list of games with scores
    function getPlayerStats(address player) external view returns (
        uint32 played,
        uint16[] memory gamesWithScores
    ) {
        played = gamesPlayed[player];
        gamesWithScores = _playerGames[player];
    }

    /// @notice Check if a score qualifies for top 10 (useful for UI before submitting)
    function wouldBeTopScore(uint16 gameId, uint256 score) external view returns (bool) {
        Score[10] storage top = _topScores[gameId];
        return top[9].score == 0 || score > top[9].score;
    }

    /// @notice Get the minimum score needed to enter top 10 for a game
    function getMinTopScore(uint16 gameId) external view returns (uint256) {
        return _topScores[gameId][9].score;
    }
}
