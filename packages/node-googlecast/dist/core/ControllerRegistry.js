export class ControllerRegistry {
    controllers = new Map();
    register(controller) {
        this.controllers.set(controller.namespace, controller);
    }
    unregister(namespace) {
        this.controllers.delete(namespace);
    }
    get(namespace) {
        return this.controllers.get(namespace);
    }
    values() {
        return this.controllers.values();
    }
}
