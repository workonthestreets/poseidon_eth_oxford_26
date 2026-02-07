"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("@nomicfoundation/hardhat-toolbox");
require("dotenv/config");
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
exports.default = config;
