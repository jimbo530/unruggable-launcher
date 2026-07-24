// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Dock — gasless-relay escrow for Shipyard launches
///
/// Lets a user pay a CHEAP tx (drop $1 USDC + name their ship) while a RELAYER
/// pays the heavy launch gas. The ship always lands in the USER's wallet — the
/// requester is stored on-chain and `launchFor(user, ...)` is always called with
/// that stored user, so a permissionless fulfiller can never steal the ship.
///
/// Flow:
///   1. user → requestLaunch(): escrow the live Shipyard launchFee in USDC.    (cheap)
///   2. relayer → fulfill(id): approve Shipyard the escrow, call launchFor.     (heavy gas)
///   3. user → reclaim(id): safety valve if no relayer shows up after 1 hour.
///
/// Non-custodial beyond escrow: no owner, no drain. ReentrancyGuard on the
/// state-changing money paths. No silent catches — failures revert visibly.

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IShipyard {
    function launchFee() external view returns (uint256);
    function launchFor(
        address shipOwner,
        string calldata name,
        string calldata symbol,
        address customUpstream
    ) external returns (address tokenAddr, address reactorAddr);
    function distributorOf(address token) external view returns (address);
}

contract Dock is ReentrancyGuard {

    address public immutable shipyard;
    address public immutable usdc;

    uint256 public constant REFUND_WINDOW = 1 hours;

    struct Request {
        address user;       // ship recipient (always); set at request time
        string  name;
        string  symbol;
        address upstream;
        uint256 amount;     // USDC escrowed (the live fee at request time)
        bool    fulfilled;  // true once launched OR reclaimed (terminal)
        uint256 createdAt;
    }

    Request[] public requests;

    event LaunchRequested(uint256 indexed id, address indexed user, string name, string symbol, uint256 amount);
    event LaunchFulfilled(uint256 indexed id, address indexed user, address token, address reactor, address distributor);
    event Refunded(uint256 indexed id, address indexed user, uint256 amount);
    event Reclaimed(uint256 indexed id, address indexed user, uint256 amount);

    constructor(address _shipyard, address _usdc) {
        require(_shipyard != address(0), "zero shipyard");
        require(_usdc != address(0), "zero usdc");
        shipyard = _shipyard;
        usdc = _usdc;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  1. requestLaunch — the cheap USER tx
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Escrow the live Shipyard launch fee and queue a launch for the
    ///         caller. User must approve EXACTLY the fee to this Dock first.
    function requestLaunch(
        string calldata name,
        string calldata symbol,
        address upstream
    ) external nonReentrant returns (uint256 id) {
        uint256 fee = IShipyard(shipyard).launchFee();
        require(fee > 0, "fee is zero");   // free launches go direct, not via Dock

        // Pull exactly the fee from the user into escrow (revert on failure).
        require(
            IERC20(usdc).transferFrom(msg.sender, address(this), fee),
            "fee escrow failed"
        );

        id = requests.length;
        requests.push(Request({
            user:      msg.sender,
            name:      name,
            symbol:    symbol,
            upstream:  upstream,
            amount:    fee,
            fulfilled: false,
            createdAt: block.timestamp
        }));

        emit LaunchRequested(id, msg.sender, name, symbol, fee);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  2. fulfill — PERMISSIONLESS; relayer pays the heavy gas, user owns ship
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Anyone (typically the relayer) launches the queued ship. The ship
    ///         + 100 crew NFTs always go to the stored `request.user`, so calling
    ///         this can never steal the ship — only spend gas to deliver it.
    function fulfill(uint256 id) external nonReentrant {
        require(id < requests.length, "bad id");
        Request storage r = requests[id];
        require(!r.fulfilled, "already done");

        // Fee-change guard: if the live fee now exceeds the escrow, we can't
        // cover the launch — revert so the user can reclaim after the window.
        uint256 liveFee = IShipyard(shipyard).launchFee();
        require(liveFee <= r.amount, "fee rose above escrow");

        // Mark terminal BEFORE any external call (reentrancy-safe).
        r.fulfilled = true;

        // Approve Shipyard ONLY the live fee (exact, never MaxUint256). If the
        // fee dropped, Shipyard pulls less and the leftover stays escrowed for
        // the user — we refund that dust below.
        _safeApprove(usdc, shipyard, liveFee);

        (address token, address reactor) = IShipyard(shipyard).launchFor(
            r.user, r.name, r.symbol, r.upstream
        );

        // Reset the approval to 0 (Shipyard should have pulled exactly liveFee).
        _safeApprove(usdc, shipyard, 0);

        // Refund any leftover escrow (fee dropped between request and fulfill).
        uint256 leftover = r.amount - liveFee;
        if (leftover > 0) {
            require(IERC20(usdc).transfer(r.user, leftover), "refund failed");
            emit Refunded(id, r.user, leftover);
        }

        address distributor = IShipyard(shipyard).distributorOf(token);
        emit LaunchFulfilled(id, r.user, token, reactor, distributor);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  3. reclaim — safety valve if no relayer shows up
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice After REFUND_WINDOW, the requester can pull their escrow back.
    ///         Only valid while the request is still unfulfilled.
    function reclaim(uint256 id) external nonReentrant {
        require(id < requests.length, "bad id");
        Request storage r = requests[id];
        require(!r.fulfilled, "already done");
        require(block.timestamp > r.createdAt + REFUND_WINDOW, "too early");
        require(msg.sender == r.user, "not requester");

        uint256 amount = r.amount;
        r.fulfilled = true;   // terminal — blocks any later fulfill

        require(IERC20(usdc).transfer(r.user, amount), "reclaim transfer failed");
        emit Reclaimed(id, r.user, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Views
    // ═══════════════════════════════════════════════════════════════════════

    function requestCount() external view returns (uint256) {
        return requests.length;
    }

    function isFulfilled(uint256 id) external view returns (bool) {
        require(id < requests.length, "bad id");
        return requests[id].fulfilled;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Internal — exact approvals only
    // ═══════════════════════════════════════════════════════════════════════

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.approve.selector, spender, 0)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "approve reset failed");
        if (amount > 0) {
            (ok, data) = token.call(
                abi.encodeWithSelector(IERC20.approve.selector, spender, amount)
            );
            require(ok && (data.length == 0 || abi.decode(data, (bool))), "approve failed");
        }
    }
}
