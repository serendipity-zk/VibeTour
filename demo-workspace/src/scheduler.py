"""Tiny multi-file scheduler used by the Code Lessons UI demo."""

from block_manager import BlockManager
from request import Request
from worker import Worker

WAITING = "waiting"
READY = "ready"


class Scheduler:
    def __init__(self, block_manager: BlockManager, worker: Worker):
        self.block_manager = block_manager
        self.worker = worker

    def schedule(self, request: Request) -> str:
        if not self.block_manager.can_allocate(request.required_blocks):
            return WAITING
        return READY

    def dispatch(self, request: Request) -> None:
        if self.schedule(request) != READY:
            return
        self.worker.execute(request)
