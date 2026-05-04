// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LaunchToken — Minimal fixed-supply ERC20
/// @notice All supply minted to a single recipient (the factory). No owner, no mint, no burn.
///         Once deployed this token is completely immutable.
contract LaunchToken {

    string public name;
    string public symbol;
    uint8  public constant decimals = 18;
    uint256 public totalSupply;
    string private _baseURI;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint256 _supply, address _recipient, string memory baseURI_) {
        require(_supply > 0, "zero supply");
        require(_recipient != address(0), "zero recipient");
        name = _name;
        symbol = _symbol;
        totalSupply = _supply;
        _baseURI = baseURI_;
        balanceOf[_recipient] = _supply;
        emit Transfer(address(0), _recipient, _supply);
    }

    /// @notice EIP-7572 contract-level metadata for aggregators
    function contractURI() external view returns (string memory) {
        return string.concat(_baseURI, _toHexString(address(this)));
    }

    function _toHexString(address addr) internal pure returns (string memory) {
        bytes memory s = new bytes(42);
        s[0] = "0";
        s[1] = "x";
        bytes memory hex16 = "0123456789abcdef";
        uint160 v = uint160(addr);
        for (uint256 i = 41; i > 1; i--) {
            s[i] = hex16[v & 0xf];
            v >>= 4;
        }
        return string(s);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 current = allowance[from][msg.sender];
        if (current != type(uint256).max) {
            require(current >= amount, "allowance exceeded");
            unchecked { allowance[from][msg.sender] = current - amount; }
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        require(from != address(0) && to != address(0), "zero address");
        require(balanceOf[from] >= amount, "exceeds balance");
        unchecked {
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
        return true;
    }
}
