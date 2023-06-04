import React from "react";
import {urlJoin} from "url-join-ts";
import {QRCodeCanvas} from "qrcode.react";

import {ComponentProps} from "../types";


export const QR: React.FC<ComponentProps> = ({id, label, value, params}) => {
    const constructURL = (!value && params);

    // Levels: L (7%), M (15%), Q (25%), H (30%)
    const level = "M";

    if (value && params) {
        console.warn(`QR component has both 'value' and 'params'. Value will be used.`);
    }

    if (constructURL) {
        const {basePath, relPath, ...urlParams} = params;
        const url = new URL(urlJoin(basePath, relPath));
        Object.entries(urlParams).forEach(([k, v]) => url.searchParams.append(k, `${v}`));
        value = url.toString();
    }

    return (
        <div id={id}>
            <div>
                <span>{label}</span>
            </div>
            <div className="image-container">
                <div className="image-aspect-helper">
                    {
                        constructURL ? (
                            <a href={value} target="_blank" rel="noreferrer">
                                <QRCodeCanvas level={level} value={value as string} className="qrcode" size={256}/>
                            </a>
                        ) : (
                            value ?
                                <QRCodeCanvas level={level} value={value} className="qrcode" size={256}/> :
                                <span>(no data)</span>
                        )
                    }
                </div>
            </div>
        </div>
    )
};
