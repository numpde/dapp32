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

const deployed = {
    ganache: {
        CaptureThatFlag: "0xb09bCc172050fBd4562da8b229Cf3E45Dc3045A6",
    },
}

export default config;
export {deployed};
