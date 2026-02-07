require("@nomicfoundation/hardhat-toolbox");
require("dotenv/config");

/** @type import('hardhat/config').HardhatUserConfig */
const config = {
    solidity: "0.8.20",
    networks: {
        coston2: {
            url: "https://coston2-api.flare.network/ext/bc/C/rpc",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            chainId: 114
        }
    }
};

module.exports = config;
