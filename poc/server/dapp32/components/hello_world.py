from reactpy import component, html


@component
def main(recipient: str):
    return html.span(f"Hello {recipient}!")
