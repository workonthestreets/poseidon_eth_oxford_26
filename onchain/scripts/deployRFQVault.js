/**
 * Deploy MaritimeRFQVault to Flare Coston2 Testnet
 * 
 * Usage: npx hardhat run onchain/scripts/deployRFQVault.js --network coston2
 */

const hre = require("hardhat");

async function main() {
    console.log("\n══════════════════════════════════════════════════════════════════");
    console.log("  🚢 Deploying MaritimeRFQVault to Flare Coston2");
    console.log("══════════════════════════════════════════════════════════════════\n");

    const [deployer] = await hre.ethers.getSigners();
    console.log("  Deployer:", deployer.address);
    
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log("  Balance:", hre.ethers.formatEther(balance), "C2FLR\n");

    if (balance < hre.ethers.parseEther("1")) {
        console.log("  ⚠️  Low balance! Get testnet tokens from:");
        console.log("     https://faucet.flare.network/coston2\n");
    }

    // Deploy
    console.log("  📦 Deploying contract...\n");
    
    const RFQVault = await hre.ethers.getContractFactory("MaritimeRFQVault");
    const vault = await RFQVault.deploy();
    await vault.waitForDeployment();

    const address = await vault.getAddress();
    
    console.log("  ✅ Contract deployed!\n");
    console.log("══════════════════════════════════════════════════════════════════");
    console.log(`  Contract Address: ${address}`);
    console.log("══════════════════════════════════════════════════════════════════\n");

    // Verify configuration
    console.log("  📋 Contract Configuration:");
    console.log("     Owner:", await vault.owner());
    console.log("     Operator:", await vault.operator());
    console.log("     Oracle:", await vault.oracle());
    console.log("     Protocol Fee:", (await vault.PROTOCOL_FEE_BPS()).toString(), "bps (2%)\n");

    // Save deployment info
    const deploymentInfo = {
        network: hre.network.name,
        chainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
        contract: "MaritimeRFQVault",
        address: address,
        deployer: deployer.address,
        deployedAt: new Date().toISOString(),
        explorerUrl: `https://coston2-explorer.flare.network/address/${address}`
    };

    console.log("  🔗 Explorer URL:");
    console.log(`     ${deploymentInfo.explorerUrl}\n`);

    // Instructions
    console.log("══════════════════════════════════════════════════════════════════");
    console.log("  📝 NEXT STEPS:");
    console.log("══════════════════════════════════════════════════════════════════\n");
    console.log("  1. Update .env with contract address:");
    console.log(`     RFQ_VAULT_ADDRESS=${address}\n`);
    console.log("  2. Start the off-chain RFQ engine:");
    console.log("     cd offchain/rfq-rs && cargo run --release\n");
    console.log("  3. Test the flow:");
    console.log("     - Deposit FLR to vault");
    console.log("     - Create market via operator");
    console.log("     - Place requests/bids off-chain");
    console.log("     - Submit emissions on-chain");
    console.log("     - Settle market with oracle\n");

    return deploymentInfo;
}

main()
    .then((info) => {
        console.log("  Deployment complete!\n");
        process.exit(0);
    })
    .catch((error) => {
        console.error("  ❌ Deployment failed:", error);
        process.exit(1);
    });
