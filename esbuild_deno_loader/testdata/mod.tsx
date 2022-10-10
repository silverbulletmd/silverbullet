function createElement(fn: () => string) {
  return fn();
}

const React = { createElement };

function Asd() {
  return "foo";
}

export default <Asd />;
