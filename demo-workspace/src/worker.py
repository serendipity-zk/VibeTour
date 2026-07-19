from request import Request


class Worker:
    def __init__(self):
        self.executed_request_ids = []

    def execute(self, request: Request) -> None:
        self.executed_request_ids.append(request.request_id)
