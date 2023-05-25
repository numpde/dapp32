import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
    solidity: "0.8.18",

    networks: {
        ganache: {
            url: "http://127.0.0.1:8546",
        },
    }
};

export default config;
