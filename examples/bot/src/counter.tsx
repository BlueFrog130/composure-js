// Inline Handlers: write the click where the button is. @composurejs/vite hoists each handler with
// a stable id; what it reads from the component (count, owner, step) travels in the custom_id,
// and markup it returns updates the clicked message.
import { Button, command, Container, Row, Text } from "composurejs";

const STEPS = [1, 5, 10];

export const Counter = ({ count, owner }: { count: number; owner: string }) => (
  <Container accentColor={0x57f287}>
    <Text>## Count: {count}</Text>
    <Row>
      {STEPS.map((step) => (
        <Button style="primary" onClick={(c) => (c.user.id === owner ? <Counter count={count + step} owner={owner} /> : c.ephemeral("Not your counter"))}>
          {`+${step}`}
        </Button>
      ))}
      <Button style="danger" onClick={(c) => (c.user.id === owner ? <Counter count={0} owner={owner} /> : c.ephemeral("Not your counter"))}>
        Reset
      </Button>
    </Row>
  </Container>
);

export const counter = command({
  name: "counter",
  description: "A counter only you can press",
  handler: (c) => <Counter count={0} owner={c.user.id} />,
});
