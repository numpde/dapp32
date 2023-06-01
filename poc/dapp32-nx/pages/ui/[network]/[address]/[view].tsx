import {Dapp32} from "../../../../app/components/Dapp32"


import {useRouter} from 'next/router';

type Route = {
    contractNetwork: string | undefined,
    contractAddress: string | undefined,
    initialView: string | undefined,
    basePath: string | undefined,
    params: { [key: string]: string | string[] | undefined },
}

export const getRoute = (): Route => {
    const router = useRouter();

    console.log("router.query:", router.query);

    const {
        network: contractNetwork,
        address: contractAddress,
        view: initialView,
        ...params
    } = router.query;

    if (Array.isArray(contractNetwork) || Array.isArray(contractAddress) || Array.isArray(initialView)) {
        throw new Error("Could not parse contract network/address/view");
    }

    const basePath = (typeof window !== 'undefined') && (window.location.origin + router.asPath.split('?')[0]) || undefined;

    const route: Route = {
        contractNetwork,
        contractAddress,
        initialView,
        basePath,
        params,
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
                params={{...route.params, basePath: route.basePath}}
            />
    );
};


export default Page;
