import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Load environment variables
import * as dotenv from "dotenv";

dotenv.config();

function getEnvVariable(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing environment variable: ${name}`);
    }

    return value;
}


const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.18",
    },


    etherscan: {
        apiKey: {
            polygonMumbai: getEnvVariable("POLYGONSCAN_API_KEY"),
            polygon: getEnvVariable("POLYGONSCAN_API_KEY"),
        }
    },

    networks: {
        ganache: {
            url: "HTTP://127.0.0.1:8545",
            accounts: [getEnvVariable("GANACHE_DAPP32_PRIVATE_KEY")],
        },

        // sepolia: {
        //     url: `https://sepolia.infura.io/v3/${myInfuraApiKey}`,
        //     accounts: [getEnvVariable("SEPOLIA_10_PRIVATE_KEY")],
        // },

        // mumbai: {
        //     url: `https://polygon-mumbai.infura.io/v3/${myInfuraApiKey}`,
        //     accounts: [getEnvVariable("MUMBAI_10_PRIVATE_KEY")],
        // },

        // polygon: {
        //     url: `https://polygon-mainnet.infura.io/v3/${myInfuraApiKey}`,
        //     accounts: [getEnvVariable("BIKE_DEPLOYER_POLYGON_PRIVATE_KEY")],
        // },
    },
};

const deployed = {
    polygon: {
    },
    mumbai: {
    },
    ganache: {
        AppUI: "0x0EbFaB7714f06cF914836cb11DF00b7231752182",
    },
};

export default config;
export {deployed};
