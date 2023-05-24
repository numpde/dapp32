import {Dapp32} from "../../../../app/components/Dapp32"


import {useRouter} from 'next/router';

type Route = {
    contractNetwork: string | undefined,
    contractAddress: string | undefined,
    initialView: string | undefined,
}

export const getRoute = (): Route => {
    const router = useRouter();

    const {
        network: contractNetwork,
        address: contractAddress,
        view: initialView
    } = router.query;

    if (Array.isArray(contractNetwork) || Array.isArray(contractAddress) || Array.isArray(initialView)) {
        throw new Error("Could not parse contract network/address/view");
    }

    const route: Route = {
        contractNetwork,
        contractAddress,
        initialView,
    }

    return route;
};

const Page = () => {
    const route = getRoute();

    return (
        !(route.contractNetwork && route.contractAddress && route.initialView)
            ?
            <div>[loading route...]</div>
            :
            <Dapp32
                contract={
                    {
                        network: route.contractNetwork,
                        address: route.contractAddress,
                        view: route.initialView,
                    }
                }
            />
    );
};


export default Page;
