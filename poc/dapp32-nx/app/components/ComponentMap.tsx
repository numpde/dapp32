import React from 'react';

const InputField = ({id, label, placeholder}) => (
    <label>
        {label}
        <input id={id} placeholder={placeholder}/>
    </label>
);

const SelectDropdown = ({id, label, options}) => (
    <label>
        {label}
        <select id={id}>
            {options.map((option, i) => <option value={option} key={i}>{option}</option>)}
        </select>
    </label>
);

const Button = ({id, label, onClick}) => (
    <button id={id} onClick={onClick}>{label}</button>
);


export const COMPONENT_MAP = {
    input: InputField,
    select: SelectDropdown,
    button: Button,
};
