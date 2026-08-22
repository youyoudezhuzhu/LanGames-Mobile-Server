package com.hanazar.langames;

/** 游戏注册信息：与 assets/nodejs-project/games.json 的条目一致（id/name/port）。 */
public class LanGame {
    public final String id;
    public final String name;
    public final int port;

    public LanGame(String id, String name, int port) {
        this.id = id;
        this.name = name;
        this.port = port;
    }

    public String buildUrl(String address) {
        return "http://" + address + ":" + port;
    }
}
