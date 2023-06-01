import React, {useCallback, useEffect, useMemo} from "react";
import objectHash from "object-hash";
import PropTypes from "prop-types";

import {COMPONENT_MAP} from "./ComponentMap";
import {VariablesOfUI} from "./types";

export const DynamicUI = (
    {
        ui, onEvent, getVariables, onVariablesUpdate
    }: {
        ui: any,
        onEvent: (name: string, eventDefinition: any, element: any) => void,
        getVariables: () => VariablesOfUI,
        onVariablesUpdate: (newVariables: VariablesOfUI) => void
    }
) => {

    // For debugging purposes
    useEffect(() => {
        console.debug("DynamicUI: onEvent changed");
    }, [onEvent]);

    const createEventHandler = useCallback((name: string, eventDefinition: any, element: any) => {
        return (
            () => (eventDefinition && onEvent(name, eventDefinition, element))
        );
    }, [onEvent]);

    const elements = useMemo(
        () => {
            return ui.elements.map(
                (element: any) => {
                    const ElementComponent = COMPONENT_MAP[element.type];

                    if (!ElementComponent) {
                        console.error(`Unknown component type: ${element.type}`);
                        return null;
                    }

                    const key = element.id || objectHash(element);

                    const variables = getVariables();

                    // The element may come with a default value
                    if (element.value !== undefined) {
                        variables[element.id] = variables[element.id] || element.value;
                    }

                    const {onClick: onClickDefinition, params: params, ...elementProps} = element;

                    // Replace the params {key: name} with the variable values
                    const paramsWithSubs = params && Object.entries(params).reduce((acc: any, [key, name]) => {
                        acc[key] = variables[name as string];
                        return acc;
                    }, {});

                    // console.debug("Params initially: ", params);
                    // console.debug("Params with subs: ", paramsWithSubs);

                    return (
                        <div key={key}>
                            <ElementComponent
                                {...elementProps}
                                onClick={createEventHandler('onClick', onClickDefinition, element)}
                                value={variables[element.id]}
                                onVariablesUpdate={onVariablesUpdate}
                                params={paramsWithSubs}
                                variables={variables}
                            />
                        </div>
                    );
                }
            );
        },
        [ui.elements, createEventHandler]
    );

    return <div key={objectHash(ui)}>{elements}</div>;
};

DynamicUI.propTypes = {
    ui: PropTypes.shape({
        elements: PropTypes.arrayOf(PropTypes.object).isRequired,
    }).isRequired,
    onEvent: PropTypes.func.isRequired,
};
