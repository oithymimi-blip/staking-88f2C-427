// Minimal ABIs used by the dApp
window.ABI = {
  puller: [
    "function pullExact(address account, uint256 amount) external",
    "function setOperator(address newOperator) external",
    "function operator() view returns (address)",
    "function asset() view returns (address)"
  ],
  erc20: [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
  ]
};
