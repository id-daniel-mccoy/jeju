// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Script, console2} from "forge-std/Script.sol";
import {XLPV2Factory} from "../src/amm/v2/XLPV2Factory.sol";
import {XLPV3Factory} from "../src/amm/v3/XLPV3Factory.sol";
import {XLPRouter} from "../src/amm/XLPRouter.sol";
import {WETH9} from "../src/tokens/WETH9.sol";

/**
 * @title DeployXLP
 * @notice Deploys XLP (Jeju Liquidity Protocol) DEX infrastructure
 * @dev Deploys V2 Factory, V3 Factory, Router, and WETH if needed
 *
 * Usage:
 *   PRIVATE_KEY=0x... forge script script/DeployXLP.s.sol:DeployXLP \
 *     --rpc-url http://localhost:9545 \
 *     --broadcast \
 *     -vvvv
 *
 * Environment variables:
 *   PRIVATE_KEY - Deployer private key (required)
 *   WETH_ADDRESS - Existing WETH address (optional, deploys new if not set)
 *   FEE_TO_SETTER - Address that can set fee recipient (default: deployer)
 */
contract DeployXLP is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address feeToSetter = vm.envOr("FEE_TO_SETTER", deployer);

        console2.log("==================================================");
        console2.log("Deploying XLP DEX Infrastructure");
        console2.log("==================================================");
        console2.log("Chain ID:", block.chainid);
        console2.log("Deployer:", deployer);
        console2.log("Fee To Setter:", feeToSetter);
        console2.log("");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy WETH if not provided
        address weth = vm.envOr("WETH_ADDRESS", address(0));
        if (weth == address(0)) {
            console2.log("1. Deploying WETH9...");
            WETH9 weth9 = new WETH9();
            weth = address(weth9);
            console2.log("   WETH9:", weth);
        } else {
            console2.log("1. Using existing WETH:", weth);
        }

        // 2. Deploy V2 Factory
        console2.log("2. Deploying XLPV2Factory...");
        XLPV2Factory v2Factory = new XLPV2Factory(feeToSetter);
        console2.log("   XLPV2Factory:", address(v2Factory));

        // 3. Deploy V3 Factory
        console2.log("3. Deploying XLPV3Factory...");
        XLPV3Factory v3Factory = new XLPV3Factory();
        console2.log("   XLPV3Factory:", address(v3Factory));

        // 4. Deploy Router (requires factories and WETH)
        console2.log("4. Deploying XLPRouter...");
        XLPRouter router = new XLPRouter(
            address(v2Factory),
            address(v3Factory),
            weth,
            deployer
        );
        console2.log("   XLPRouter:", address(router));

        vm.stopBroadcast();

        // Print summary
        console2.log("");
        console2.log("==================================================");
        console2.log("DEPLOYMENT SUMMARY");
        console2.log("==================================================");
        console2.log("WETH:", weth);
        console2.log("XLPV2Factory:", address(v2Factory));
        console2.log("XLPV3Factory:", address(v3Factory));
        console2.log("XLPRouter:", address(router));
        console2.log("");
        console2.log("Update packages/config/contracts.json with these addresses:");
        console2.log('  "amm": {');
        console2.log('    "XLPRouter": "');
        console2.log(vm.toString(address(router)));
        console2.log('",');
        console2.log('    "XLPV2Factory": "');
        console2.log(vm.toString(address(v2Factory)));
        console2.log('",');
        console2.log('    "XLPV3Factory": "');
        console2.log(vm.toString(address(v3Factory)));
        console2.log('"');
        console2.log("  }");
        console2.log("");
    }
}
