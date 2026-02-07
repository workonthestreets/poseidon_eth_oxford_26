const artifacts = require("@flarenetwork/flare-periphery-contract-artifacts");

console.log("Keys:", Object.keys(artifacts));

if (artifacts.coston2) {
    console.log("IWeb2JsonVerification:", JSON.stringify(artifacts.coston2.interfaceAbis.IWeb2JsonVerification, null, 2));
    console.log("IAddressValidity:", JSON.stringify(artifacts.coston2.interfaceAbis.IAddressValidity, null, 2));
}
