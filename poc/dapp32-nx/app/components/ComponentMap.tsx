import React, {useState, useEffect} from 'react';

const etv = ((handler) => ((event) => handler(event.target.value)));

const InputField = ({id, label, placeholder, value: initialValue, onVariableUpdate}) => {
    const [value, setValue] = useState((initialValue || '') as string);

    useEffect(() => onVariableUpdate(id, value), [value, id, onVariableUpdate]);

    return (
        <label>
            {label}
            <input id={id} placeholder={placeholder} value={value} onInput={etv(setValue)}/>
        </label>
    );
};

const SelectDropdown = ({id, label, options, value: initialValue, onVariableUpdate}) => {
    const [value, setValue] = useState((initialValue || '') as string);

    useEffect(() => onVariableUpdate(id, value), [value, id, onVariableUpdate]);

    return (
        <label>
            {label}
            <select id={id} value={value} onChange={etv(setValue)}>
                {
                    // if value is not in options, add it as an option
                    !options.includes(value) &&
                    <option value={value} key={value}>{value}</option>
                }
                {options.map((option, i) => <option value={option} key={i}>{option}</option>)}
            </select>
        </label>
    )
};

const Button = ({id, label, onClick}) => (
    <button id={id} onClick={onClick}>{label}</button>
);


export const COMPONENT_MAP = {
    input: InputField,
    select: SelectDropdown,
    button: Button,
};
