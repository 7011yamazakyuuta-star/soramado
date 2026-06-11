import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';

registerSW({ immediate: true });

new App().start();
