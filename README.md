# moziot-deepspeech

This is a super basic and simple example of an extension add-on for the
WebThings Gateway.

# rebuild KenLM

Cross-compiling can be non trivial. Building on-device is easier in this case:

```
$ sudo apt install build-essential cmake libboost-program-options-dev libboost-system-dev libboost-thread-dev libboost-test-dev libbz2-dev liblzma-dev zlib1g-dev
$ mkdir -p $HOME/kenlm/build && cd $HOME/kenlm
$ git clone https://github.com/kpu/kenlm
$ cd $HOME/kenlm/build
$ export EIGEN3_ROOT=$HOME/eigen-eigen-07105f7124f9
$ (cd $HOME; wget -O - https://bitbucket.org/eigen/eigen/get/3.2.8.tar.bz2 |tar xj)
$ cmake -DFORCE_STATIC=ON ../kenlm/
$ make -j build_binary lmplz
```

Then copy in bin/
