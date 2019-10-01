const makeANiceEmail = (text) => `
  <div
    className="email"
    style="
      padding: 20px;
      border: 1px solid black;
      font-family: sans-serif;
      font-size: 20px;
      line-height: 2;
    "
  >
    <h2>Hello there,</h2>
    <p>${text}</p>

    <br />
    <p>😘, Diarybun</p>
  </div>
`

exports.makeANiceEmail = makeANiceEmail
