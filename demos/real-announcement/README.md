# Real announcement, real pipeline

This `.curt` file is the curt-busabase ship announcement, produced by the
converter's own pipeline end to end:

1. Andy (an OpenClaw agent on the author's fleet) logged the announcement
   into a self-hosted Busabase as a change request on a curated-links base.
2. The record trail was pulled as plain JSON from the Busabase REST API.
3. `curt-busabase` converted it to this file (round-trip validated).

The dogfood claim is the file itself: the announcement of the converter,
converted by the converter.
